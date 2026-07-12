(function (window, document) {
    'use strict';

    var ROOT_CLASS = 'easymde-immersive-workspace';
    var ACTIVE_CLASS = 'easymde-immersive-workspace-active';
    var OUTLINE_MIN_WIDTH = 190;
    var OUTLINE_DEFAULT_WIDTH = 240;
    var OUTLINE_MAX_WIDTH = 360;
    var aiLogoSequence = 0;

    function normalizeLineEndings(value) {
        return String(value || '').replace(/\r\n?/g, '\n');
    }

    function normalizeTitle(value) {
        return normalizeLineEndings(value).replace(/[ \t\f\v]*\n+[ \t\f\v]*/g, ' ');
    }

    function clampSourceRatio(value) {
        return Math.max(0.25, Math.min(0.75, Number(value) || 0.5));
    }

    function clampOutlineWidth(value) {
        var width = Number(value);

        if (value === null || value === '' || !isFinite(width)) {
            return OUTLINE_DEFAULT_WIDTH;
        }

        return Math.max(OUTLINE_MIN_WIDTH, Math.min(OUTLINE_MAX_WIDTH, width));
    }

    function normalizeTableDimensions(rows, columns) {
        var normalizedRows = Number(rows);
        var normalizedColumns = Number(columns);

        if (
            rows === ''
            || rows === null
            || columns === ''
            || columns === null
            || !Number.isInteger(normalizedRows)
            || !Number.isInteger(normalizedColumns)
        ) {
            throw new Error('Table rows and columns must be whole numbers.');
        }
        if (normalizedRows < 1 || normalizedRows > 20 || normalizedColumns < 1 || normalizedColumns > 20) {
            throw new Error('Table rows and columns must be between 1 and 20.');
        }

        return { rows: normalizedRows, columns: normalizedColumns };
    }

    function createTableMarkdown(rows, columns, labels) {
        var dimensions = normalizeTableDimensions(rows, columns);
        var columnLabel = labels && labels.column ? String(labels.column) : 'Column ';
        var contentLabel = labels && labels.content ? String(labels.content) : 'Content';
        var header = [];
        var separator = [];
        var content = [];
        var lines = [];
        var index;

        for (index = 1; index <= dimensions.columns; index += 1) {
            header.push(columnLabel + String(index));
            separator.push('---');
            content.push(contentLabel);
        }
        lines.push('| ' + header.join(' | ') + ' |');
        lines.push('| ' + separator.join(' | ') + ' |');
        for (index = 1; index < dimensions.rows; index += 1) {
            lines.push('| ' + content.join(' | ') + ' |');
        }

        return lines.join('\n');
    }

    function calculateSourceRatioFromPointer(clientX, metrics) {
        var dividerWidth = Number(metrics && metrics.dividerWidth);
        var gap = Number(metrics && metrics.gap);
        var pointerOffset = Number(metrics && metrics.pointerOffset);
        var previewRight = Number(metrics && metrics.previewRight);
        var sourceLeft = Number(metrics && metrics.sourceLeft);
        var availableWidth = previewRight - sourceLeft - (gap * 2) - dividerWidth;
        var sourceWidth;

        if (
            !isFinite(Number(clientX))
            || !isFinite(dividerWidth)
            || !isFinite(gap)
            || !isFinite(pointerOffset)
            || !isFinite(previewRight)
            || !isFinite(sourceLeft)
            || availableWidth <= 0
        ) {
            throw new Error('Invalid immersive workspace divider geometry.');
        }

        sourceWidth = Number(clientX) - pointerOffset - sourceLeft - gap;
        return clampSourceRatio(sourceWidth / availableWidth);
    }

    function stripCommonMarkContainerPrefixes(line) {
        var previous = null;

        while (previous !== line) {
            previous = line;
            line = line.replace(/^ {0,3}>[ \t]?/, '');
            line = line.replace(/^ {0,3}(?:[-+*]|\d{1,9}[.)])[ \t]+/, '');
        }

        return line;
    }

    function advanceFence(line, fence) {
        var match = line.match(/^ {0,3}(`{3,}|~{3,})([^\r\n]*)$/);
        var marker;

        if (fence) {
            if (match) {
                marker = match[1];
                if (
                    marker.charAt(0) === fence.marker
                    && marker.length >= fence.length
                    && !match[2].trim()
                ) {
                    return { consumed: true, fence: null };
                }
            }
            return { consumed: true, fence: fence };
        }

        if (!match) {
            return { consumed: false, fence: null };
        }

        return {
            consumed: true,
            fence: {
                marker: match[1].charAt(0),
                length: match[1].length
            }
        };
    }

    function calculateStats(markdown) {
        var normalized = normalizeLineEndings(markdown);
        var western = normalized.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) || [];
        var cjk = normalized.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g) || [];
        var readingUnits = western.length + cjk.length;

        return {
            lines: normalized.split('\n').length,
            words: western.length,
            cjk: cjk.length,
            characters: Array.from(normalized.replace(/\n/g, '')).length,
            readMinutes: Math.max(1, Math.ceil(readingUnits / 300))
        };
    }

    function uniqueStrings(values, caseInsensitive) {
        var seen = Object.create(null);
        var input = Array.isArray(values) ? values : String(values || '').split(',');

        return input.reduce(function (result, value) {
            var normalized = String(value === null || value === undefined ? '' : value).replace(/\s+/g, ' ').trim();
            var key = caseInsensitive ? normalized.toLocaleLowerCase() : normalized;
            if (!normalized || seen[key]) {
                return result;
            }
            seen[key] = true;
            result.push(normalized);
            return result;
        }, []);
    }

    function createPublishCategoryTree(options) {
        var nodes = Object.create(null);
        var ordered = [];

        (Array.isArray(options) ? options : []).forEach(function (option) {
            var id = String(option && option.id || '');
            var node;

            if (!id || nodes[id]) {
                return;
            }
            node = {
                id: id,
                label: String(option.label || id),
                parentId: String(option.parentId || ''),
                hasChildren: !!option.hasChildren,
                children: []
            };
            nodes[id] = node;
            ordered.push(node);
        });

        function canAttach(node, parent) {
            var cursor = parent;
            var seen = Object.create(null);

            while (cursor) {
                if (cursor.id === node.id || seen[cursor.id]) {
                    return false;
                }
                seen[cursor.id] = true;
                cursor = nodes[cursor.parentId] || null;
            }
            return true;
        }

        ordered.forEach(function (node) {
            var parent = nodes[node.parentId];

            if (parent && canAttach(node, parent)) {
                parent.children.push(node);
                parent.hasChildren = true;
            }
        });

        return ordered.filter(function (node) {
            var parent = nodes[node.parentId];
            return !parent || !canAttach(node, parent);
        });
    }

    function createPublishDraft(options) {
        var postStatus;
        var visibility;

        options = options || {};
        postStatus = String(options.postStatus || '').toLowerCase();
        visibility = String(options.visibility || '').toLowerCase();
        if (['public', 'password', 'private'].indexOf(visibility) === -1) {
            visibility = postStatus === 'private' ? 'private' : 'public';
        }

        return {
            categories: uniqueStrings(options.categories || [], false),
            excerpt: String(options.excerpt || ''),
            featuredImage: options.featuredImage && Number(options.featuredImage.id) > 0
                ? {
                    id: Number(options.featuredImage.id),
                    url: String(options.featuredImage.url || ''),
                    alt: String(options.featuredImage.alt || '')
                }
                : null,
            mode: ['publish', 'future', 'private'].indexOf(postStatus) !== -1
                ? 'update'
                : 'publish',
            openPreview: !!options.openPreview,
            password: visibility === 'password' ? String(options.password || '') : '',
            sticky: visibility === 'public' && !!options.sticky,
            tags: uniqueStrings(options.tags || [], true),
            visibility: visibility
        };
    }

    function validatePublishDraft(draft) {
        if (
            draft
            && draft.visibility === 'password'
            && !String(draft.password || '').trim()
        ) {
            return 'password-required';
        }

        return '';
    }

    function parseOutline(markdown) {
        var normalized = normalizeLineEndings(markdown);
        var lines = normalized.split('\n');
        var outline = [];
        var hierarchy = [];
        var sectionHierarchy = null;
        var offset = 0;
        var fence = null;
        var index;

        for (index = 0; index < lines.length; index += 1) {
            var line = lines[index];
            var contentLine = stripCommonMarkContainerPrefixes(line);
            var fenceState = advanceFence(contentLine, fence);
            var atxMatch;
            var setextMatch;
            var text;

            fence = fenceState.fence;
            if (fenceState.consumed) {
                offset += line.length + 1;
                continue;
            }

            if (/^ {4}|^\t/.test(contentLine)) {
                offset += line.length + 1;
                continue;
            }

            atxMatch = line.match(/^\s{0,3}(#{1,6})[ \t]+(.+?)\s*#*\s*$/);
            if (atxMatch && !/^\s*\\#/.test(line)) {
                text = atxMatch[2].trim();
                if (text) {
                    outline.push({
                        key: String(offset) + ':' + String(atxMatch[1].length),
                        level: atxMatch[1].length,
                        text: text,
                        offset: offset
                    });
                }
                offset += line.length + 1;
                continue;
            }

            if (index + 1 < lines.length && line.trim() && !/^\s*\\/.test(line)) {
                setextMatch = lines[index + 1].match(/^\s{0,3}(=+|-+)\s*$/);
                if (setextMatch) {
                    outline.push({
                        key: String(offset) + ':setext',
                        level: setextMatch[1].charAt(0) === '=' ? 1 : 2,
                        text: line.trim(),
                        offset: offset
                    });
                }
            }

            offset += line.length + 1;
        }

        outline.forEach(function (entry, entryIndex) {
            var isNumberedSection = /^\d+\.\s*/.test(entry.text);

            if (entryIndex === 0 || isNumberedSection) {
                entry.depth = 0;
                hierarchy = [entry.level];
                sectionHierarchy = isNumberedSection ? [entry.level] : null;
                return;
            }

            if (sectionHierarchy) {
                while (
                    sectionHierarchy.length > 1
                    && sectionHierarchy[sectionHierarchy.length - 1] >= entry.level
                ) {
                    sectionHierarchy.pop();
                }
                entry.depth = sectionHierarchy.length;
                sectionHierarchy.push(entry.level);
                return;
            }

            while (hierarchy.length && hierarchy[hierarchy.length - 1] >= entry.level) {
                hierarchy.pop();
            }
            entry.depth = hierarchy.length;
            hierarchy.push(entry.level);
        });

        return outline;
    }

    function getOutlineIconName(title) {
        var normalized = String(title || '').toLocaleLowerCase();

        if (/mermaid/.test(normalized)) {
            if (/饼图/.test(normalized)) {
                return 'pie-chart';
            }
            if (/甘特/.test(normalized)) {
                return 'bar-chart-3';
            }
            if (/状态图/.test(normalized)) {
                return 'circle-dot';
            }
            if (/(关系图|er )/.test(normalized)) {
                return 'database';
            }
            if (/思维导图/.test(normalized)) {
                return 'git-branch';
            }
            if (/(时间线|时序)/.test(normalized)) {
                return 'clock';
            }
            return 'workflow';
        }
        if (/(引用式链接|引用式)/.test(normalized)) {
            return 'link';
        }
        if (/(链接与图片|图片)/.test(normalized)) {
            return 'image';
        }
        if (/(引用块|blockquote)/.test(normalized)) {
            return 'quote';
        }
        if (/(无序|有序|任务列表)/.test(normalized)) {
            return 'list-checks';
        }
        if (/(分隔线|hr|rule)/.test(normalized)) {
            return 'minus';
        }
        if (/(表格|table)/.test(normalized)) {
            return 'table';
        }
        if (/(行内代码|代码块|html|标签)/.test(normalized)) {
            return 'code';
        }
        if (/(数学|公式|矩阵|方程|统计|softmax|前向传播)/.test(normalized)) {
            return 'sigma';
        }
        if (/(折叠内容|折叠)/.test(normalized)) {
            return 'list-collapse';
        }
        if (/(综合示例|监控|服务监控|指标|错误率|面板|dashboard)/.test(normalized)) {
            return 'bar-chart-3';
        }
        return 'file-text';
    }

    function findFirstLocalImageCandidate(markdown, options) {
        var normalized = normalizeLineEndings(markdown);
        var lines = normalized.split('\n');
        var baseUrl = options && (options.uploadsUrl || options.siteUrl) ? String(options.uploadsUrl || options.siteUrl) : '';
        var uploadsUrl = options && options.uploadsUrl ? String(options.uploadsUrl) : '';
        var uploadsPath = options && options.uploadsPath ? String(options.uploadsPath) : '';
        var base;
        var allowedPath;
        var fence = null;
        var index;

        if (!baseUrl) {
            return null;
        }

        try {
            base = new URL(baseUrl);
            allowedPath = uploadsUrl ? new URL(uploadsUrl, base).pathname : uploadsPath;
        } catch (error) {
            return null;
        }

        allowedPath = String(allowedPath || '').replace(/\/+$/, '') + '/';
        if (allowedPath === '/') {
            return null;
        }

        for (index = 0; index < lines.length; index += 1) {
            var line = lines[index];
            var contentLine = stripCommonMarkContainerPrefixes(line);
            var fenceState = advanceFence(contentLine, fence);
            var imagePattern;
            var match;

            fence = fenceState.fence;
            if (fenceState.consumed) {
                continue;
            }

            if (/^ {4}|^\t/.test(contentLine)) {
                continue;
            }

            imagePattern = /!\[([^\]]*)\]\(\s*(?:<([^>\s]+)>|([^\s)]+))(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;
            while ((match = imagePattern.exec(contentLine)) !== null) {
                var slashPrefix = contentLine.slice(0, match.index).match(/\\+$/);
                var rawUrl = match[2] || match[3] || '';
                var resolved;

                if (slashPrefix && slashPrefix[0].length % 2 === 1) {
                    continue;
                }

                try {
                    resolved = new URL(rawUrl, base);
                } catch (error) {
                    continue;
                }

                if (
                    (resolved.protocol !== 'http:' && resolved.protocol !== 'https:')
                    || resolved.origin !== base.origin
                    || resolved.pathname.indexOf(allowedPath) !== 0
                ) {
                    continue;
                }

                resolved.hash = '';
                resolved.search = '';
                return {
                    alt: String(match[1] || '').trim(),
                    url: resolved.href
                };
            }
        }

        return null;
    }

    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // Lucide 0.487.0 icon nodes used by the reference workspace design.
    // Keeping the exact paths here avoids loading React or remote icon assets.
    var ICON_NODES = {
        'align-left': '<path d="M15 12H3"></path><path d="M17 18H3"></path><path d="M21 6H3"></path>',
        'at-sign': '<circle cx="12" cy="12" r="4"></circle><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"></path>',
        'bar-chart-3': '<path d="M3 3v16a2 2 0 0 0 2 2h16"></path><path d="M18 17V9"></path><path d="M13 17V5"></path><path d="M8 17v-3"></path>',
        bot: '<path d="M12 8V4H8"></path><rect width="16" height="12" x="4" y="8" rx="2"></rect><path d="M2 14h2"></path><path d="M20 14h2"></path><path d="M15 13v2"></path><path d="M9 13v2"></path>',
        brain: '<path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"></path><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"></path><path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4"></path><path d="M17.599 6.5a3 3 0 0 0 .399-1.375"></path><path d="M6.003 5.125A3 3 0 0 0 6.401 6.5"></path><path d="M3.477 10.896a4 4 0 0 1 .585-.396"></path><path d="M19.938 10.5a4 4 0 0 1 .585.396"></path><path d="M6 18a4 4 0 0 1-1.967-.516"></path><path d="M19.967 17.484A4 4 0 0 1 18 18"></path>',
        bold: '<path d="M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8"></path>',
        boxes: '<path d="M2.97 12.92A2 2 0 0 0 2 14.63v3.24a2 2 0 0 0 .97 1.71l3 1.8a2 2 0 0 0 2.06 0L12 19v-5.5l-5-3-4.03 2.42Z"></path><path d="m7 16.5-4.74-2.85"></path><path d="m7 16.5 5-3"></path><path d="M7 16.5v5.17"></path><path d="M12 13.5V19l3.97 2.38a2 2 0 0 0 2.06 0l3-1.8a2 2 0 0 0 .97-1.71v-3.24a2 2 0 0 0-.97-1.71L17 10.5l-5 3Z"></path><path d="m17 16.5-5-3"></path><path d="m17 16.5 4.74-2.85"></path><path d="M17 16.5v5.17"></path><path d="M7.97 4.42A2 2 0 0 0 7 6.13v4.37l5 3 5-3V6.13a2 2 0 0 0-.97-1.71l-3-1.8a2 2 0 0 0-2.06 0l-3 1.8Z"></path><path d="M12 8 7.26 5.15"></path><path d="m12 8 4.74-2.85"></path><path d="M12 13.5V8"></path>',
        'calendar-check': '<path d="M8 2v4"></path><path d="M16 2v4"></path><rect width="18" height="18" x="3" y="4" rx="2"></rect><path d="M3 10h18"></path><path d="m9 16 2 2 4-4"></path>',
        check: '<path d="M20 6 9 17l-5-5"></path>',
        'chevron-down': '<path d="m6 9 6 6 6-6"></path>',
        'chevron-left': '<path d="m15 18-6-6 6-6"></path>',
        'chevron-right': '<path d="m9 18 6-6-6-6"></path>',
        'chevrons-left': '<path d="m11 17-5-5 5-5"></path><path d="m18 17-5-5 5-5"></path>',
        'circle-dot': '<circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="1"></circle>',
        clock: '<circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline>',
        code: '<polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline>',
        'code-xml': '<path d="m18 16 4-4-4-4"></path><path d="m6 8-4 4 4 4"></path><path d="m14.5 4-5 16"></path>',
        'columns-2': '<rect width="18" height="18" x="3" y="3" rx="2"></rect><path d="M12 3v18"></path>',
        copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path>',
        database: '<ellipse cx="12" cy="5" rx="9" ry="3"></ellipse><path d="M3 5V19A9 3 0 0 0 21 19V5"></path><path d="M3 12A9 3 0 0 0 21 12"></path>',
        ellipsis: '<circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle><circle cx="5" cy="12" r="1"></circle>',
        eye: '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"></path><circle cx="12" cy="12" r="3"></circle>',
        'file-text': '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"></path><path d="M14 2v4a2 2 0 0 0 2 2h4"></path><path d="M10 9H8"></path><path d="M16 13H8"></path><path d="M16 17H8"></path>',
        'git-branch': '<line x1="6" x2="6" y1="3" y2="15"></line><circle cx="18" cy="6" r="3"></circle><circle cx="6" cy="18" r="3"></circle><path d="M18 9a9 9 0 0 1-9 9"></path>',
        hash: '<line x1="4" x2="20" y1="9" y2="9"></line><line x1="4" x2="20" y1="15" y2="15"></line><line x1="10" x2="8" y1="3" y2="21"></line><line x1="16" x2="14" y1="3" y2="21"></line>',
        history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path><path d="M12 7v5l4 2"></path>',
        info: '<circle cx="12" cy="12" r="10"></circle><path d="M12 16v-4"></path><path d="M12 8h.01"></path>',
        image: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"></rect><circle cx="9" cy="9" r="2"></circle><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"></path>',
        'image-plus': '<path d="M16 5h6"></path><path d="M19 2v6"></path><path d="M21 11.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7.5"></path><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"></path><circle cx="9" cy="9" r="2"></circle>',
        italic: '<line x1="19" x2="10" y1="4" y2="4"></line><line x1="14" x2="5" y1="20" y2="20"></line><line x1="15" x2="9" y1="4" y2="20"></line>',
        'layout-grid': '<rect width="7" height="7" x="3" y="3" rx="1"></rect><rect width="7" height="7" x="14" y="3" rx="1"></rect><rect width="7" height="7" x="14" y="14" rx="1"></rect><rect width="7" height="7" x="3" y="14" rx="1"></rect>',
        link: '<path d="M9 17H7A5 5 0 0 1 7 7h2"></path><path d="M15 7h2a5 5 0 1 1 0 10h-2"></path><line x1="8" x2="16" y1="12" y2="12"></line>',
        lightbulb: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"></path><path d="M9 18h6"></path><path d="M10 22h4"></path>',
        list: '<path d="M3 12h.01"></path><path d="M3 18h.01"></path><path d="M3 6h.01"></path><path d="M8 12h13"></path><path d="M8 18h13"></path><path d="M8 6h13"></path>',
        'list-checks': '<path d="m3 17 2 2 4-4"></path><path d="m3 7 2 2 4-4"></path><path d="M13 6h8"></path><path d="M13 12h8"></path><path d="M13 18h8"></path>',
        'list-collapse': '<path d="m3 10 2.5-2.5L3 5"></path><path d="m3 19 2.5-2.5L3 14"></path><path d="M10 6h11"></path><path d="M10 12h11"></path><path d="M10 18h11"></path>',
        'list-ordered': '<path d="M10 12h11"></path><path d="M10 18h11"></path><path d="M10 6h11"></path><path d="M4 10h2"></path><path d="M4 6h1v4"></path><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"></path>',
        maximize: '<path d="M8 3H5a2 2 0 0 0-2 2v3"></path><path d="M21 8V5a2 2 0 0 0-2-2h-3"></path><path d="M3 16v3a2 2 0 0 0 2 2h3"></path><path d="M16 21h3a2 2 0 0 0 2-2v-3"></path>',
        menu: '<line x1="4" x2="20" y1="12" y2="12"></line><line x1="4" x2="20" y1="6" y2="6"></line><line x1="4" x2="20" y1="18" y2="18"></line>',
        minimize: '<path d="M8 3v3a2 2 0 0 1-2 2H3"></path><path d="M21 8h-3a2 2 0 0 1-2-2V3"></path><path d="M3 16h3a2 2 0 0 1 2 2v3"></path><path d="M16 21v-3a2 2 0 0 1 2-2h3"></path>',
        minus: '<path d="M5 12h14"></path>',
        palette: '<circle cx="13.5" cy="6.5" r=".5" fill="currentColor"></circle><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"></circle><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"></circle><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"></circle><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"></path>',
        paperclip: '<path d="M13.234 20.252 21 12.3"></path><path d="m16 6-8.414 8.586a2 2 0 0 0 0 2.828 2 2 0 0 0 2.828 0l8.414-8.586a4 4 0 0 0 0-5.656 4 4 0 0 0-5.656 0l-8.415 8.585a6 6 0 1 0 8.486 8.486"></path>',
        'pen-line': '<path d="M12 20h9"></path><path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z"></path>',
        pin: '<path d="M12 17v5"></path><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"></path>',
        plus: '<path d="M5 12h14"></path><path d="M12 5v14"></path>',
        'pie-chart': '<path d="M21 12c.552 0 1.005-.449.95-.998a10 10 0 0 0-8.953-8.951c-.55-.055-.998.398-.998.95v8a1 1 0 0 0 1 1z"></path><path d="M21.21 15.89A10 10 0 1 1 8 2.83"></path>',
        quote: '<path d="M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"></path><path d="M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"></path>',
        'refresh-cw': '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"></path><path d="M21 3v5h-5"></path><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"></path><path d="M8 16H3v5"></path>',
        'rotate-ccw': '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path>',
        save: '<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"></path><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"></path><path d="M7 3v4a1 1 0 0 0 1 1h7"></path>',
        send: '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"></path><path d="m21.854 2.147-10.94 10.939"></path>',
        'settings-2': '<path d="M20 7h-9"></path><path d="M14 17H5"></path><circle cx="17" cy="17" r="3"></circle><circle cx="7" cy="7" r="3"></circle>',
        'shield-check': '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"></path><path d="m9 12 2 2 4-4"></path>',
        settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path><circle cx="12" cy="12" r="3"></circle>',
        smartphone: '<rect width="14" height="20" x="5" y="2" rx="2" ry="2"></rect><path d="M12 18h.01"></path>',
        'square-pen': '<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"></path>',
        sigma: '<path d="M18 7V5a1 1 0 0 0-1-1H6.5a.5.5 0 0 0-.4.8l4.5 6a2 2 0 0 1 0 2.4l-4.5 6a.5.5 0 0 0 .4.8H17a1 1 0 0 0 1-1v-2"></path>',
        sparkles: '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"></path><path d="M20 3v4"></path><path d="M22 5h-4"></path><path d="M4 17v2"></path><path d="M5 18H3"></path>',
        strikethrough: '<path d="M16 4H9a3 3 0 0 0-2.83 4"></path><path d="M14 12a4 4 0 0 1 0 8H6"></path><line x1="4" x2="20" y1="12" y2="12"></line>',
        table: '<path d="M12 3v18"></path><rect width="18" height="18" x="3" y="3" rx="2"></rect><path d="M3 9h18"></path><path d="M3 15h18"></path>',
        'trash-2': '<path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path><line x1="10" x2="10" y1="11" y2="17"></line><line x1="14" x2="14" y1="11" y2="17"></line>',
        type: '<polyline points="4 7 4 4 20 4 20 7"></polyline><line x1="9" x2="15" y1="20" y2="20"></line><line x1="12" x2="12" y1="4" y2="20"></line>',
        'wand-sparkles': '<path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72"></path><path d="m14 7 3 3"></path><path d="M5 6v4"></path><path d="M19 14v4"></path><path d="M10 2v2"></path><path d="M7 8H3"></path><path d="M21 16h-4"></path><path d="M11 3H9"></path>',
        'graduation-cap': '<path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z"></path><path d="M22 10v6"></path><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"></path>',
        workflow: '<rect width="8" height="8" x="3" y="3" rx="2"></rect><path d="M7 11v4a2 2 0 0 0 2 2h4"></path><rect width="8" height="8" x="13" y="13" rx="2"></rect>',
        x: '<path d="M18 6 6 18"></path><path d="m6 6 12 12"></path>'
    };

    var ARTICLE_THEME_SWATCHES = {
        'default': '#333333',
        'orange-heart': '#ff6200',
        'chazi-purple': '#8e44ad',
        'nenqing-green': '#00b4a6',
        'green-vitality': '#27ae60',
        'red-crimson': '#e74c3c',
        'blue-ying': '#1e90ff',
        'lanqing': '#4a90e2',
        'yamabuki': '#d4ac0d',
        'grid-black': '#6c63ff',
        'geek-black': '#00e676',
        'rose-purple': '#e91e8c',
        'ningye-purple': '#b39ddb',
        'tech-blue': '#29b6f6',
        'qingbi-liujin': '#009688',
        'qinghe-zhusha': '#c0392b',
        'cute-green': '#4caf50',
        'fullstack-blue': '#1565c0',
        'minimal-black': '#212121',
        'orange-blue': '#ff6b35',
        'frontend-peak': '#4a90d9',
        'cupid-busy': '#ff4081'
    };

    var CODE_THEME_SWATCHES = {
        'github': ['#f6f8fa', '#24292e'],
        'github-dark': ['#0d1117', '#c9d1d9'],
        'atom-one-dark': ['#282c34', '#abb2bf'],
        'atom-one-light': ['#fafafa', '#383a42'],
        'monokai': ['#272822', '#f8f8f2'],
        'vs2015': ['#1e1e1e', '#dcdcdc'],
        'xcode': ['#ffffff', '#1d1d1f'],
        'wechat-inspired': ['#f4f4f4', '#333333']
    };

    var DEFAULT_CUSTOM_CSS = [
        '/* Write custom CSS here. */',
        '/* Selectors are scoped to the rendered article automatically. */',
        '',
        ':root {',
        "  font-family: 'Georgia', serif;",
        '  font-size: 15px;',
        '  line-height: 1.9;',
        '  color: #1a1a1a;',
        '}',
        '',
        'h1 {',
        '  font-size: 2rem;',
        '  font-weight: 700;',
        '  color: #111;',
        '  letter-spacing: -0.02em;',
        '  margin: 1.5rem 0 0.75rem;',
        '}',
        '',
        'h2 {',
        '  font-size: 1.1rem;',
        '  font-weight: 600;',
        '  text-transform: uppercase;',
        '  letter-spacing: 0.08em;',
        '  border-bottom: 2px solid #111;',
        '  padding-bottom: 0.4rem;',
        '  margin: 1.8rem 0 0.5rem;',
        '  display: inline-block;',
        '}',
        '',
        'a {',
        '  color: #1a1a1a;',
        '  border-bottom: 1px solid #aaa;',
        '  text-decoration: none;',
        '}',
        '',
        'blockquote {',
        '  border-left: 3px solid #111;',
        '  background: #f5f5f5;',
        '  padding: 0.8rem 1rem;',
        '  color: #555;',
        '  font-style: italic;',
        '}',
        '',
        'code {',
        '  background: #f0f0f0;',
        '  color: #333;',
        '  padding: 0.1em 0.35em;',
        '  border-radius: 3px;',
        "  font-family: 'EasyMDE UI JetBrains Mono', monospace;",
        '  font-size: 0.83em;',
        '}',
        '',
        'ul li::before {',
        '  content: "-";',
        '  color: #111;',
        '  margin-right: 0.5rem;',
        '  font-weight: 600;',
        '}'
    ].join('\n');

    function iconMarkup(name, size, strokeWidth, className, strokeColor) {
        if (!Object.prototype.hasOwnProperty.call(ICON_NODES, name)) {
            throw new Error('Unknown immersive workspace icon: ' + name);
        }

        return '<svg class="easymde-immersive-icon' + (className ? ' ' + escapeHtml(className) : '') + '" width="' +
            String(size || 14) + '" height="' + String(size || 14) + '" viewBox="0 0 24 24" fill="none" stroke="' + escapeHtml(strokeColor || 'currentColor') + '" stroke-width="' +
            String(strokeWidth || 2) + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
            ICON_NODES[name] + '</svg>';
    }

    function aiLogoMarkup(size) {
        var gradientId;

        size = Number(size) || 40;
        aiLogoSequence += 1;
        gradientId = 'easymde-ai-grad-' + String(aiLogoSequence);
        return '<svg class="easymde-immersive-workspace__ai-logo" width="' + size + '" height="' + size + '" viewBox="0 0 48 48" fill="none" aria-hidden="true" focusable="false">' +
            '<defs><linearGradient id="' + gradientId + '" x1="4" y1="3" x2="44" y2="46" gradientUnits="userSpaceOnUse"><stop stop-color="#6d43f5"></stop><stop offset="1" stop-color="#8d62fa"></stop></linearGradient></defs>' +
            '<rect width="48" height="48" rx="12" fill="url(#' + gradientId + ')"></rect>' +
            '<path d="M25 10c.8 7.2 4.8 11.2 12 12-7.2.8-11.2 4.8-12 12-.8-7.2-4.8-11.2-12-12 7.2-.8 11.2-4.8 12-12Z" fill="white"></path>' +
            '<path d="M36 28c.35 3.2 2.15 5 5.35 5.35C38.15 33.7 36.35 35.5 36 38.7c-.35-3.2-2.15-5-5.35-5.35C33.85 33 35.65 31.2 36 28Z" fill="white" opacity=".9"></path>' +
            '<path d="M12 10c.25 2.2 1.5 3.45 3.7 3.7-2.2.25-3.45 1.5-3.7 3.7-.25-2.2-1.5-3.45-3.7-3.7 2.2-.25 3.45-1.5 3.7-3.7Z" fill="white" opacity=".9"></path></svg>';
    }

    function aiModelGlyphMarkup(size) {
        size = Number(size) || 16;
        return '<svg class="easymde-immersive-icon" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">' +
            '<path d="m12 2.75 7.35 4.3v9.9L12 21.25l-7.35-4.3v-9.9L12 2.75Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"></path>' +
            '<path d="m12 7.2 3.95 2.3v5L12 16.8l-3.95-2.3v-5L12 7.2Z" fill="currentColor" opacity=".16"></path>' +
            '<path d="m4.9 7.25 7.1 4.1 7.1-4.1M12 11.35v9.45" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round"></path>' +
            '<circle cx="12" cy="11.35" r="1.55" fill="currentColor"></circle></svg>';
    }

    function aiThinkingDepthGlyphMarkup(size) {
        size = Number(size) || 16;
        return '<svg class="easymde-immersive-icon" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">' +
            '<path d="M18.45 17.35A8.35 8.35 0 1 1 18.1 6.3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>' +
            '<path d="m6.7 12.3 2.65-.05 1.45-3.05 2.35 6.05 1.5-3h2.7" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"></path>' +
            '<circle cx="19.25" cy="7.15" r="1.75" fill="currentColor"></circle>' +
            '<path d="M17.35 19.05a8.4 8.4 0 0 1-3.55 1.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" opacity=".42"></path></svg>';
    }

    function publishIconMarkup() {
        return '<span class="easymde-immersive-workspace__publish-icon" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 18 18" fill="none" focusable="false">' +
            '<path d="M5.75 2.75H10.45L13.5 5.8V13.5C13.5 14.19 12.94 14.75 12.25 14.75H5.75C5.06 14.75 4.5 14.19 4.5 13.5V4C4.5 3.31 5.06 2.75 5.75 2.75Z" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"></path>' +
            '<path d="M10.25 2.9V6.05H13.4" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"></path>' +
            '<path d="M9 12.6V8.35M7.25 10.1L9 8.35L10.75 10.1" stroke="#8DD7FF" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round"></path>' +
            '</svg></span>';
    }

    function publishHeaderArtMarkup() {
        return '<svg class="easymde-immersive-workspace__publish-header-art" viewBox="0 0 1120 82" fill="none" preserveAspectRatio="none" aria-hidden="true" focusable="false">' +
            '<defs>' +
                '<linearGradient id="easymde-publish-hill-back" x1="410" y1="0" x2="1120" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#edf2fb" stop-opacity="0"></stop><stop offset="24%" stop-color="#edf2fb" stop-opacity="0.42"></stop><stop offset="100%" stop-color="#edf2fb" stop-opacity="0.66"></stop></linearGradient>' +
                '<linearGradient id="easymde-publish-hill-mid" x1="460" y1="0" x2="1120" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#e3eaf7" stop-opacity="0"></stop><stop offset="28%" stop-color="#e3eaf7" stop-opacity="0.38"></stop><stop offset="100%" stop-color="#dce5f5" stop-opacity="0.62"></stop></linearGradient>' +
                '<linearGradient id="easymde-publish-hill-front" x1="500" y1="0" x2="1120" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#d5e0f2" stop-opacity="0"></stop><stop offset="30%" stop-color="#d5e0f2" stop-opacity="0.32"></stop><stop offset="100%" stop-color="#cbd9ee" stop-opacity="0.58"></stop></linearGradient>' +
            '</defs>' +
            '<path d="M390 82 C474 80 520 59 592 45 C665 31 718 53 778 55 C849 58 902 30 974 27 C1036 24 1081 38 1120 48 L1120 82Z" fill="url(#easymde-publish-hill-back)"></path>' +
            '<path d="M430 82 C515 81 573 66 650 58 C728 50 793 54 854 61 C918 68 965 45 1022 44 C1065 43 1096 51 1120 57 L1120 82Z" fill="url(#easymde-publish-hill-mid)"></path>' +
            '<path d="M470 82 C578 82 651 75 733 70 C817 65 882 67 940 72 C1005 77 1060 72 1120 68 L1120 82Z" fill="url(#easymde-publish-hill-front)"></path>' +
        '</svg>' +
        '<svg class="easymde-immersive-workspace__publish-sparkle is-large" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 0C12 6.5 13 9.5 15 11.5C17.5 13.5 20 14 24 14C20 14 17.5 14.5 15 16.5C13 18.5 12 21.5 12 28C12 21.5 11 18.5 9 16.5C6.5 14.5 4 14 0 14C4 14 6.5 13.5 9 11.5C11 9.5 12 6.5 12 0Z"></path></svg>' +
        '<svg class="easymde-immersive-workspace__publish-sparkle is-small" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 0C12 6.5 13 9.5 15 11.5C17.5 13.5 20 14 24 14C20 14 17.5 14.5 15 16.5C13 18.5 12 21.5 12 28C12 21.5 11 18.5 9 16.5C6.5 14.5 4 14 0 14C4 14 6.5 13.5 9 11.5C11 9.5 12 6.5 12 0Z"></path></svg>';
    }

    function publishFeaturedPlaceholderMarkup() {
        return '<svg class="easymde-immersive-workspace__featured-placeholder-art" width="200" height="133" viewBox="0 0 240 160" fill="none" aria-hidden="true" focusable="false">' +
            '<defs><clipPath id="easymde-publish-featured-image-front-clip"><rect x="62" y="30" width="112" height="104" rx="12"></rect></clipPath><linearGradient id="easymde-publish-featured-mountain-far" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#d5e3fc"></stop><stop offset="100%" stop-color="#a9c5f6"></stop></linearGradient><linearGradient id="easymde-publish-featured-mountain-near" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#a8c4f5"></stop><stop offset="100%" stop-color="#739eeb"></stop></linearGradient><radialGradient id="easymde-publish-featured-sun" cx="35%" cy="30%" r="72%"><stop offset="0%" stop-color="#cfe0ff"></stop><stop offset="100%" stop-color="#7ea9f2"></stop></radialGradient><linearGradient id="easymde-publish-featured-cloud-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#ffffff"></stop><stop offset="100%" stop-color="#f4f7ff"></stop></linearGradient><filter id="easymde-publish-featured-frame-shadow" x="-30%" y="-30%" width="170%" height="190%"><feDropShadow dx="0" dy="5" stdDeviation="4" flood-color="#2563eb" flood-opacity="0.18"></feDropShadow></filter></defs>' +
            '<path d="M27 72 C27 82 20 89 10 89 C20 89 27 96 27 106 C27 96 34 89 44 89 C34 89 27 82 27 72 Z" fill="#22df67" transform="translate(27 89) scale(.6) translate(-27 -89)"></path><circle cx="20" cy="134" r="3.2" fill="#86aef3"></circle><path d="M201 24 C201 34 194 41 184 41 C194 41 201 48 201 58 C201 48 208 41 218 41 C208 41 201 34 201 24 Z" fill="#f5b33f" transform="translate(201 41) scale(.6) translate(-201 -41)"></path><circle cx="226" cy="83" r="5" stroke="#a9c2ee" stroke-width="1.7" fill="none"></circle>' +
            '<rect x="60" y="38" width="108" height="98" rx="11" fill="#ffffff" fill-opacity="0.62" stroke="#b8ccf4" stroke-width="1.5" transform="rotate(-8 114 87)"></rect><rect x="75" y="23" width="108" height="100" rx="11" fill="#f8fbff" stroke="#a9c2f1" stroke-width="1.5" transform="rotate(6 129 73)"></rect>' +
            '<g transform="rotate(12 118 82)" filter="url(#easymde-publish-featured-frame-shadow)"><rect x="62" y="30" width="112" height="104" rx="12" fill="white" stroke="#2f6bef" stroke-width="2"></rect><g clip-path="url(#easymde-publish-featured-image-front-clip)"><circle cx="91" cy="57" r="9" fill="url(#easymde-publish-featured-sun)"></circle><path d="M64 134 L105 76 L140 134 Z" fill="url(#easymde-publish-featured-mountain-far)"></path><path d="M92 134 L139 91 L174 134 Z" fill="url(#easymde-publish-featured-mountain-near)"></path></g></g>' +
            '<g transform="translate(142, 98) scale(4)" filter="url(#easymde-publish-featured-frame-shadow)"><path d="M4.406 3.342A5.53 5.53 0 0 1 8 2c2.69 0 4.923 2 5.166 4.579C14.758 6.804 16 8.137 16 9.773 16 11.569 14.502 13 12.687 13H3.781C1.708 13 0 11.366 0 9.318c0-1.763 1.266-3.223 2.942-3.593.143-.863.698-1.723 1.464-2.383z" fill="url(#easymde-publish-featured-cloud-fill)" stroke="#2f6bef" stroke-width="0.7" stroke-linejoin="round"></path><path d="M8 11 V5.2" stroke="#2f6bef" stroke-width="0.85" stroke-linecap="round"></path><path d="M5.6 7.6 L8 5.2 L10.4 7.6" stroke="#2f6bef" stroke-width="0.85" stroke-linecap="round" stroke-linejoin="round" fill="none"></path></g>' +
        '</svg>';
    }

    function publishButtonSparklesMarkup() {
        return '<span class="easymde-immersive-workspace__publish-button-sparkles" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 1.5c0 6.351 4.65 11.5 11.5 11.5-6.85 0-11.5 5.149-11.5 11.5C12 18.149 7.35 13 0.5 13 7.35 13 12 7.851 12 1.5Z"></path></svg><svg viewBox="0 0 24 24"><path d="M12 1.5c0 6.351 4.65 11.5 11.5 11.5-6.85 0-11.5 5.149-11.5 11.5C12 18.149 7.35 13 0.5 13 7.35 13 12 7.851 12 1.5Z"></path></svg></span>';
    }

    function workspaceMarkup(strings) {
        var label = function (key, fallback) {
            return escapeHtml(strings && strings[key] ? strings[key] : fallback);
        };

        return '' +
            '<div class="easymde-immersive-workspace__shell">' +
                '<header class="easymde-immersive-workspace__header">' +
                    '<div class="easymde-immersive-workspace__brand" aria-label="EasyMDE">' +
                        '<span class="easymde-immersive-workspace__traffic" aria-hidden="true"><i></i><i></i><i></i></span>' +
                        '<span class="easymde-immersive-workspace__brand-name">' + iconMarkup('pen-line', 15, 2.5) + '<strong>EasyMDE</strong></span>' +
                        '<span class="easymde-immersive-workspace__brand-divider" aria-hidden="true">|</span>' +
                    '</div>' +
                    '<div class="easymde-immersive-workspace__title-wrap">' +
                        '<div class="easymde-immersive-workspace__title-grid"><span class="easymde-immersive-workspace__title-mirror" data-title-mirror aria-hidden="true"></span><textarea id="easymde-immersive-title" name="easymde_immersive_title" class="easymde-immersive-workspace__title" rows="1" aria-label="' + label('postTitle', 'Post title') + '" placeholder="' + label('postTitlePlaceholder', 'Article title...') + '"></textarea></div>' +
                        iconMarkup('chevron-down', 14, 2) +
                    '</div>' +
                    '<span class="easymde-immersive-workspace__status-gap" aria-hidden="true"></span>' +
                    '<button type="button" class="easymde-immersive-workspace__save-status" data-action="save" title="' + label('saved', 'Saved') + '">' + iconMarkup('check', 13, 2.5) + '<span>' + label('saved', 'Saved') + '</span></button>' +
                    '<button type="button" class="easymde-immersive-workspace__header-stats" data-action="statistics" aria-expanded="false" aria-controls="easymde-immersive-statistics">' +
                        '<span><b data-stat-summary="words">0</b> ' + label('wordsShort', 'words') + '</span>' +
                        '<span><b data-stat-summary="characters">0</b> ' + label('charactersShort', 'characters') + '</span>' +
                        '<span>' + label('about', 'about') + ' <b data-stat-summary="read-minutes">0</b> ' + label('minutesShort', 'min') + '</span>' +
                    '</button>' +
                    '<span class="easymde-immersive-workspace__header-spacer" aria-hidden="true"></span>' +
                    '<div class="easymde-immersive-workspace__view-switch" role="group" aria-label="' + label('viewMode', 'View mode') + '">' +
                        '<button type="button" data-view="edit" title="' + label('editMode', 'Edit') + '" aria-label="' + label('editMode', 'Edit') + '">' + iconMarkup('pen-line', 13, 2) + '<span>' + label('editMode', 'Edit') + '</span></button>' +
                        '<button type="button" data-view="split" class="is-active" title="' + label('splitMode', 'Split') + '" aria-label="' + label('splitMode', 'Split') + '">' + iconMarkup('columns-2', 13, 2) + '<span>' + label('splitMode', 'Split') + '</span></button>' +
                        '<button type="button" data-view="preview" title="' + label('previewMode', 'Preview') + '" aria-label="' + label('previewMode', 'Preview') + '">' + iconMarkup('eye', 13, 2) + '<span>' + label('previewMode', 'Preview') + '</span></button>' +
                    '</div>' +
                    '<span class="easymde-immersive-workspace__header-spacer is-wide" aria-hidden="true"></span>' +
                    '<nav class="easymde-immersive-workspace__primary-actions" aria-label="' + label('editorActions', 'Editor actions') + '">' +
                        '<button type="button" data-action="ai" title="' + label('aiAssistant', 'AI Assistant') + '" aria-label="' + label('aiAssistant', 'AI Assistant') + '" aria-expanded="false" class="easymde-immersive-workspace__ai-button">' + iconMarkup('sparkles', 13, 2) + '<span>' + label('aiAssistant', 'AI Assistant') + '</span></button>' +
                        '<span class="easymde-immersive-workspace__action-separator" aria-hidden="true"></span>' +
                        '<button type="button" data-action="publish" class="easymde-immersive-workspace__publish-button" aria-label="' + label('publishArticle', 'Publish article') + '" title="' + label('publishArticleShortcut', 'Publish article (⌘↵)') + '">' + publishIconMarkup() + '<span data-publish-label>' + label('publishArticle', 'Publish article') + '</span><kbd aria-hidden="true">&#8984;&#8629;</kbd></button>' +
                    '</nav>' +
                '</header>' +
                '<div class="easymde-immersive-workspace__toolbar" role="toolbar" aria-label="' + label('markdownToolbar', 'Markdown toolbar') + '">' +
                    '<div class="easymde-immersive-workspace__format-actions">' +
                        '<button type="button" data-command="bold" title="' + label('boldShortcutTitle', 'Bold (Ctrl+B)') + '" aria-label="' + label('bold', 'Bold') + '">' + iconMarkup('bold', 14, 2.5) + '</button>' +
                        '<button type="button" data-command="italic" title="' + label('italicShortcutTitle', 'Italic (Ctrl+I)') + '" aria-label="' + label('italic', 'Italic') + '">' + iconMarkup('italic', 14, 2.5) + '</button>' +
                        '<button type="button" data-command="strike" title="' + label('strikethrough', 'Strikethrough') + '" aria-label="' + label('strikethrough', 'Strikethrough') + '">' + iconMarkup('strikethrough', 14, 2) + '</button>' +
                        '<i aria-hidden="true"></i>' +
                        '<i aria-hidden="true"></i>' +
                        '<button type="button" data-command="heading" class="easymde-immersive-workspace__heading-button" title="' + label('headings', 'Headings') + '" aria-label="' + label('headings', 'Headings') + '"><strong aria-hidden="true">H</strong>' + iconMarkup('chevron-down', 9, 2.5) + '</button>' +
                        '<i class="easymde-immersive-workspace__heading-separator" aria-hidden="true"></i>' +
                        '<button type="button" data-command="quote" title="' + label('quoteTitle', 'Blockquote') + '" aria-label="' + label('quote', 'Quote') + '">' + iconMarkup('quote', 14, 2) + '</button>' +
                        '<button type="button" data-command="unorderedlist" title="' + label('unorderedList', 'Unordered list') + '" aria-label="' + label('unorderedList', 'Unordered list') + '">' + iconMarkup('list', 14, 2) + '</button>' +
                        '<button type="button" data-command="orderedlist" title="' + label('orderedList', 'Ordered list') + '" aria-label="' + label('orderedList', 'Ordered list') + '">' + iconMarkup('list-ordered', 14, 2) + '</button>' +
                        '<i aria-hidden="true"></i>' +
                        '<button type="button" data-command="inlinecode" title="' + label('inlineCode', 'Inline code') + '" aria-label="' + label('inlineCode', 'Inline code') + '">' + iconMarkup('code', 14, 2) + '</button>' +
                        '<button type="button" data-command="codefence" title="' + label('codeFence', 'Code fence') + '" aria-label="' + label('codeFence', 'Code fence') + '">' + iconMarkup('code-xml', 14, 2) + '</button>' +
                        '<i aria-hidden="true"></i>' +
                        '<button type="button" data-command="link" title="' + label('link', 'Link') + '" aria-label="' + label('link', 'Link') + '">' + iconMarkup('link', 14, 2) + '</button>' +
                        '<button type="button" data-command="image" title="' + label('image', 'Image') + '" aria-label="' + label('image', 'Image') + '">' + iconMarkup('image', 14, 2) + '</button>' +
                        '<button type="button" data-command="table" title="' + label('table', 'Table') + '" aria-label="' + label('table', 'Table') + '">' + iconMarkup('table', 14, 2) + '</button>' +
                        '<i aria-hidden="true"></i>' +
                        '<button type="button" data-view="edit" title="' + label('editModeTitle', 'Edit mode') + '" aria-label="' + label('editMode', 'Edit') + '">' + iconMarkup('align-left', 14, 2) + '</button>' +
                        '<button type="button" data-view="split" class="is-active" title="' + label('splitModeTitle', 'Split mode') + '" aria-label="' + label('splitMode', 'Split') + '">' + iconMarkup('layout-grid', 14, 2) + '</button>' +
                        '<button type="button" data-view="preview" title="' + label('previewModeTitle', 'Preview mode') + '" aria-label="' + label('previewMode', 'Preview') + '">' + iconMarkup('eye', 14, 2) + '</button>' +
                        '<button type="button" data-action="exit" title="' + label('immersiveModeTitle', 'Immersive writing') + '" aria-label="' + label('exitImmersive', 'Exit immersive writing') + '">' + iconMarkup('maximize', 14, 2) + '</button>' +
                    '</div>' +
                    '<div class="easymde-immersive-workspace__secondary-actions">' +
                        '<button type="button" data-action="wechat" class="easymde-immersive-workspace__wechat-button" title="' + label('copyWechatImmersiveTitle', 'Copy current preview content to WeChat') + '" aria-label="' + label('copyWechatTitle', 'Copy preview for WeChat') + '"><span data-wechat-icon aria-hidden="true"></span><span data-wechat-label>' + label('copyWechat', 'Copy to WeChat') + '</span></button>' +
                        '<span class="easymde-immersive-workspace__wechat-status" data-wechat-status role="status" aria-live="polite"></span>' +
                        '<button type="button" data-action="history" title="' + label('history', 'History') + '" aria-label="' + label('history', 'History') + '">' + iconMarkup('history', 13, 2) + '<span>' + label('historyShort', 'History') + '</span></button>' +
                        '<button type="button" data-action="theme" title="' + label('themeTitle', 'Switch theme') + '" aria-label="' + label('theme', 'Theme') + '">' + iconMarkup('palette', 13, 2) + '<span>' + label('theme', 'Theme') + '</span><i class="easymde-immersive-workspace__theme-dot" aria-hidden="true"></i></button>' +
                        '<button type="button" data-action="font" title="' + label('fontTitle', 'Font settings') + '" aria-label="' + label('font', 'Font') + '">' + iconMarkup('type', 13, 2) + '<span>' + label('font', 'Font') + '</span></button>' +
                        '<button type="button" data-action="settings" title="' + label('editorSettings', 'Editor settings') + '" aria-expanded="false" aria-label="' + label('editorSettings', 'Editor settings') + '">' + iconMarkup('settings', 14, 2) + iconMarkup('chevron-down', 10, 2.5) + '</button>' +
                    '</div>' +
                '</div>' +
                '<main class="easymde-immersive-workspace__main" data-view="split">' +
                    '<aside id="easymde-immersive-outline-card" class="easymde-immersive-workspace__outline-card">' +
                        '<header><strong>' + label('outline', 'Outline') + '</strong><button type="button" data-action="toggle-outline" title="' + label('closeOutline', 'Close outline') + '" aria-label="' + label('closeOutline', 'Close outline') + '">' + iconMarkup('x', 14, 2) + '</button></header>' +
                        '<nav class="easymde-immersive-workspace__outline" aria-label="' + label('outline', 'Outline') + '"></nav>' +
                        '<footer><button type="button" data-action="toggle-outline" title="' + label('closeOutline', 'Close outline') + '" aria-label="' + label('closeOutline', 'Close outline') + '">' + iconMarkup('chevrons-left', 13, 2) + label('closeOutline', 'Close outline') + '</button></footer>' +
                    '</aside>' +
                    '<div class="easymde-immersive-workspace__outline-resizer" role="separator" tabindex="0" aria-orientation="vertical" aria-valuemin="190" aria-valuemax="360" aria-valuenow="240" aria-label="' + label('resizeOutline', 'Resize outline') + '"></div>' +
                    '<button type="button" class="easymde-immersive-workspace__outline-handle" data-action="toggle-outline" aria-controls="easymde-immersive-outline-card" title="' + label('openOutline', 'Open outline') + '" aria-label="' + label('openOutline', 'Open outline') + '">' + iconMarkup('chevrons-left', 16, 2) + '</button>' +
                    '<section class="easymde-immersive-workspace__editor-card">' +
                        '<header><strong>MARKDOWN</strong><button type="button" class="easymde-immersive-workspace__panel-action" aria-label="' + label('moreActions', 'More actions') + '">' + iconMarkup('ellipsis', 16, 2) + '</button></header>' +
                        '<div class="easymde-immersive-workspace__editor-body"><div class="easymde-immersive-workspace__line-numbers" aria-hidden="true"></div><div class="easymde-immersive-workspace__source-stack"><pre class="easymde-immersive-workspace__source-highlight" aria-hidden="true"></pre><textarea id="easymde-immersive-source" name="easymde_immersive_markdown" class="easymde-immersive-workspace__source" spellcheck="false" wrap="off" placeholder="' + label('sourcePlaceholder', 'Start writing...') + '"></textarea></div></div>' +
                        '<footer><span class="easymde-immersive-workspace__cursor">' + label('lineColumn', 'Line 1, Column 1') + '</span><span>Markdown <span data-local-drafts-status><i></i> ' + label('localDraftsEnabled', 'Local drafts enabled') + '</span></span></footer>' +
                    '</section>' +
                    '<div class="easymde-immersive-workspace__divider" role="separator" tabindex="0" aria-orientation="vertical" aria-valuemin="25" aria-valuemax="75" aria-valuenow="50"></div>' +
                    '<section class="easymde-immersive-workspace__preview-card">' +
                        '<header><strong>' + label('previewMode', 'Preview') + '</strong><button type="button" class="easymde-immersive-workspace__panel-action" aria-label="' + label('moreActions', 'More actions') + '">' + iconMarkup('ellipsis', 16, 2) + '</button></header>' +
                        '<div class="easymde-immersive-workspace__preview-scroll"><article class="easymde-immersive-workspace__preview" aria-live="polite"></article></div>' +
                    '</section>' +
                '</main>' +
                '<div class="easymde-immersive-workspace__popover easymde-immersive-workspace__settings-popover" data-popover="settings" role="dialog" aria-label="' + label('editorSettings', 'Editor settings') + '" hidden>' +
                    '<span class="easymde-immersive-workspace__settings-tail" aria-hidden="true"></span>' +
                    '<div class="easymde-immersive-workspace__settings-header"><strong>' + label('settings', 'Settings') + '</strong><button type="button" data-action="close-popovers" aria-label="' + label('close', 'Close') + '">' + iconMarkup('x', 15, 2.2) + '</button></div>' +
                    '<div class="easymde-immersive-workspace__settings-body">' +
                        '<button type="button" class="easymde-immersive-workspace__settings-row" data-setting="outline" role="checkbox" aria-checked="true" aria-label="' + label('settingsOutline', 'Article outline') + '"><span class="easymde-immersive-workspace__settings-check" aria-hidden="true">' + iconMarkup('check', 20, 2.8) + '</span><span class="easymde-immersive-workspace__settings-copy"><strong>' + label('settingsOutline', 'Article outline') + '</strong><small>' + label('settingsOutlineHelp', 'Show heading hierarchy navigation on the left') + '</small></span></button>' +
                        '<button type="button" class="easymde-immersive-workspace__settings-row" data-setting="word-count" role="checkbox" aria-checked="true" aria-label="' + label('settingsWordCount', 'Word count') + '"><span class="easymde-immersive-workspace__settings-check" aria-hidden="true">' + iconMarkup('check', 20, 2.8) + '</span><span class="easymde-immersive-workspace__settings-copy"><strong>' + label('settingsWordCount', 'Word count') + '</strong><small>' + label('settingsWordCountHelp', 'Show words, characters, and reading time beside the article title') + '</small></span></button>' +
                        '<button type="button" class="easymde-immersive-workspace__settings-row" data-setting="split" role="checkbox" aria-checked="true" aria-label="' + label('settingsSplitPreview', 'Split preview') + '"><span class="easymde-immersive-workspace__settings-check" aria-hidden="true">' + iconMarkup('check', 20, 2.8) + '</span><span class="easymde-immersive-workspace__settings-copy"><strong>' + label('settingsSplitPreview', 'Split preview') + '</strong><small>' + label('settingsSplitPreviewHelp', 'Show the live preview area by default') + '</small></span></button>' +
                        '<button type="button" class="easymde-immersive-workspace__settings-row" data-setting="auto-save" role="checkbox" aria-checked="true" aria-label="' + label('autoSave', 'Auto save') + '"><span class="easymde-immersive-workspace__settings-check" aria-hidden="true">' + iconMarkup('check', 20, 2.8) + '</span><span class="easymde-immersive-workspace__settings-copy"><strong>' + label('autoSave', 'Auto save') + '</strong><small>' + label('autoSaveHelp', 'Automatically save local drafts') + '</small></span></button>' +
                        '<button type="button" class="easymde-immersive-workspace__settings-row" data-setting="sync" role="checkbox" aria-checked="true" aria-label="' + label('settingsSyncScroll', 'Sync scrolling') + '"><span class="easymde-immersive-workspace__settings-check" aria-hidden="true">' + iconMarkup('check', 20, 2.8) + '</span><span class="easymde-immersive-workspace__settings-copy"><strong>' + label('settingsSyncScroll', 'Sync scrolling') + '</strong><small>' + label('settingsSyncScrollHelp', 'Link the editor and preview areas') + '</small></span></button>' +
                        '<button type="button" class="easymde-immersive-workspace__settings-row" data-setting="ai-autocomplete" role="checkbox" aria-checked="true" aria-label="' + label('settingsAiAutocomplete', 'AI autocomplete') + '"><span class="easymde-immersive-workspace__settings-check" aria-hidden="true">' + iconMarkup('check', 20, 2.8) + '</span><span class="easymde-immersive-workspace__settings-copy"><strong>' + label('settingsAiAutocomplete', 'AI autocomplete') + '</strong><small>' + label('settingsAiAutocompleteHelp', 'Provide intelligent continuation suggestions while writing') + '</small></span></button>' +
                    '</div>' +
                '</div>' +
                '<div class="easymde-immersive-workspace__popover easymde-immersive-workspace__appearance" data-popover="appearance" role="dialog" hidden>' +
                    '<div data-appearance-fields></div>' +
                '</div>' +
                '<div id="easymde-immersive-statistics" class="easymde-immersive-workspace__popover easymde-immersive-workspace__statistics" data-popover="statistics" hidden>' +
                    '<header><strong>' + label('statistics', 'Writing statistics') + '</strong><button type="button" data-action="close-popovers" aria-label="' + label('close', 'Close') + '">' + iconMarkup('x', 14, 2) + '</button></header>' +
                    '<div class="easymde-immersive-workspace__statistics-grid" aria-live="polite">' +
                        '<div><strong data-stat="read-minutes">0</strong><span>' + label('readingTime', 'Reading time (minutes)') + '</span></div>' +
                        '<div><strong data-stat="lines">0</strong><span>' + label('lines', 'Lines') + '</span></div>' +
                        '<div><strong data-stat="words">0</strong><span>' + label('westernWords', 'Western words') + '</span></div>' +
                        '<div><strong data-stat="cjk">0</strong><span>' + label('cjkCharacters', 'CJK characters') + '</span></div>' +
                        '<div><strong data-stat="characters">0</strong><span>' + label('totalCharacters', 'Total characters') + '</span></div>' +
                    '</div>' +
                    '<p data-statistics-help>' + label('statisticsHelp', 'Reading time is estimated locally at 300 reading units per minute; each Western word and CJK character counts as one unit.') + '</p>' +
                '</div>' +
                '<aside class="easymde-immersive-workspace__ai" hidden aria-label="' + label('aiAssistant', 'AI Assistant') + '">' +
                    '<div class="easymde-immersive-workspace__ai-header"><div class="easymde-immersive-workspace__ai-heading">' + aiLogoMarkup(40) + '<div><strong>' + label('aiAssistant', 'AI Assistant') + '</strong><span><i aria-hidden="true"></i>' + label('aiSupportStatus', '随时为你提供创作支持') + '</span></div></div><div class="easymde-immersive-workspace__ai-header-actions"><button type="button" class="easymde-immersive-workspace__ai-header-button" data-action="ai-pin" aria-label="' + label('aiPin', '固定 AI 助手') + '" aria-pressed="false">' + iconMarkup('pin', 19, 2) + '</button><button type="button" class="easymde-immersive-workspace__ai-header-button" data-action="ai-settings" title="' + label('aiSettingsUnavailableTitle', '设置功能尚未接入') + '" aria-label="' + label('aiSettingsUnavailable', 'AI 设置（尚未接入）') + '" disabled>' + iconMarkup('settings', 19, 2) + '</button><button type="button" class="easymde-immersive-workspace__ai-header-button" data-action="close-ai" aria-label="' + label('closeAiAssistant', '关闭 AI 助手') + '">' + iconMarkup('x', 21, 2) + '</button></div></div>' +
                    '<div class="easymde-immersive-workspace__ai-body" data-ai-body>' +
                        '<div class="easymde-immersive-workspace__ai-empty" data-ai-empty><section class="easymde-immersive-workspace__ai-greeting"><h3>Hi！我是你的创作伙伴' + iconMarkup('sparkles', 22, 2) + '</h3><p>' + label('aiPartnerHelp', '从一个明确目标开始，其他细节可以在对话中继续补充。') + '</p></section>' +
                            '<section class="easymde-immersive-workspace__ai-start" aria-labelledby="easymde-ai-start-heading"><h4 id="easymde-ai-start-heading">' + label('aiStartCreating', '开始创作') + '</h4><div class="easymde-immersive-workspace__ai-prompt-cards">' +
                                '<button type="button" class="easymde-immersive-workspace__ai-prompt-card is-outline" data-ai-prompt="请为当前文章生成结构清晰的大纲和多个吸引人的标题"><span class="easymde-immersive-workspace__ai-prompt-icon">' + iconMarkup('file-text', 24, 2) + '</span><span class="easymde-immersive-workspace__ai-prompt-copy"><strong>' + label('aiSuggestionOutline', 'Generate an article outline and title') + '</strong><small>' + label('aiSuggestionOutlineHelp', '快速生成结构清晰的大纲与吸引人的标题') + '</small></span><span class="easymde-immersive-workspace__ai-prompt-arrow" aria-hidden="true">→</span></button>' +
                                '<button type="button" class="easymde-immersive-workspace__ai-prompt-card is-introduction" data-ai-prompt="请根据当前文章内容撰写引言并补充必要的背景信息"><span class="easymde-immersive-workspace__ai-prompt-icon">' + iconMarkup('wand-sparkles', 24, 2) + '</span><span class="easymde-immersive-workspace__ai-prompt-copy"><strong>' + label('aiSuggestionIntroduction', 'Write an introduction and background') + '</strong><small>' + label('aiSuggestionIntroductionHelp', '为文章撰写引言或补充背景信息') + '</small></span><span class="easymde-immersive-workspace__ai-prompt-arrow" aria-hidden="true">→</span></button>' +
                                '<button type="button" class="easymde-immersive-workspace__ai-prompt-card is-concepts" data-ai-prompt="请识别当前文章中的核心概念，并进行简明解释与扩展"><span class="easymde-immersive-workspace__ai-prompt-icon">' + iconMarkup('lightbulb', 24, 2) + '</span><span class="easymde-immersive-workspace__ai-prompt-copy"><strong>' + label('aiSuggestionConcepts', 'Explain the core concepts') + '</strong><small>' + label('aiSuggestionConceptsHelp', '对关键概念进行简明解释与扩展') + '</small></span><span class="easymde-immersive-workspace__ai-prompt-arrow" aria-hidden="true">→</span></button>' +
                            '</div></section>' +
                            '<section class="easymde-immersive-workspace__ai-quick" aria-labelledby="easymde-ai-quick-heading"><h4 id="easymde-ai-quick-heading">' + label('aiQuickActions', '快速处理') + '</h4><div class="easymde-immersive-workspace__ai-quick-actions"><button type="button" data-ai-prompt="请智能优化当前文章的排版">' + iconMarkup('wand-sparkles', 15, 2.1, '', '#6848ff') + '<span>' + label('aiSmartLayout', 'Smart layout') + '</span></button><button type="button" data-ai-prompt="请润色并优化当前文章全文">' + iconMarkup('align-left', 15, 2.1, '', '#08bf82') + '<span>' + label('aiOptimizeArticle', 'Optimize article') + '</span></button><button type="button" data-ai-prompt="请为当前文章提炼一段简洁摘要">' + iconMarkup('file-text', 15, 2.1, '', '#5a43f4') + '<span>' + label('aiExtractSummary', 'Extract summary') + '</span></button></div></section>' +
                        '</div>' +
                        '<div class="easymde-immersive-workspace__ai-messages" data-ai-messages hidden></div>' +
                    '</div>' +
                    '<form class="easymde-immersive-workspace__ai-composer" data-ai-form>' +
                        '<div class="easymde-immersive-workspace__ai-input-wrap"><div class="easymde-immersive-workspace__ai-context"><button type="button" class="easymde-immersive-workspace__ai-context-button" data-action="ai-context" aria-label="' + label('aiAddContext', '添加上下文') + '" aria-haspopup="menu" aria-expanded="false">' + iconMarkup('plus', 19, 2) + '</button><div class="easymde-immersive-workspace__ai-menu easymde-immersive-workspace__ai-context-menu" data-ai-menu="context" role="menu" aria-label="' + label('aiAddContext', '添加上下文') + '" hidden><div>' + label('add', '添加') + '</div><button type="button" class="easymde-immersive-workspace__ai-context-menu-item" role="menuitem" data-action="ai-attachment">' + iconMarkup('paperclip', 16, 2) + label('aiUploadAttachment', '上传文件或附件') + '</button><div>' + label('skills', '技能') + '</div><button type="button" class="easymde-immersive-workspace__ai-context-menu-item" role="menuitem" data-ai-skill="Documents">' + iconMarkup('at-sign', 16, 2, '', '#6848f5') + 'Documents</button><button type="button" class="easymde-immersive-workspace__ai-context-menu-item" role="menuitem" data-ai-skill="PDF">' + iconMarkup('at-sign', 16, 2, '', '#6848f5') + 'PDF</button><button type="button" class="easymde-immersive-workspace__ai-context-menu-item" role="menuitem" data-ai-skill="Spreadsheets">' + iconMarkup('at-sign', 16, 2, '', '#6848f5') + 'Spreadsheets</button><button type="button" class="easymde-immersive-workspace__ai-context-menu-item" role="menuitem" data-ai-skill="Presentations">' + iconMarkup('at-sign', 16, 2, '', '#6848f5') + 'Presentations</button></div></div><input id="easymde-immersive-ai-file" name="easymde_immersive_ai_file" class="easymde-immersive-workspace__ai-file" data-ai-file type="file" tabindex="-1"><textarea id="easymde-immersive-ai-input" name="easymde_immersive_ai_input" autocomplete="off" aria-label="' + label('aiDemoInput', '输入创作意图') + '" placeholder="' + label('aiWritingPlaceholder', 'Describe what you want to create...') + '" rows="2"></textarea><button type="button" class="easymde-immersive-workspace__ai-attachment" data-ai-attachment title="' + label('aiRemoveAttachment', 'Remove attachment') + '" hidden></button>' +
                            '<div class="easymde-immersive-workspace__ai-composer-footer"><div class="easymde-immersive-workspace__ai-mode"><button type="button" class="easymde-immersive-workspace__ai-mode-trigger" data-action="ai-mode" aria-haspopup="listbox" aria-expanded="false">' + iconMarkup('sparkles', 15, 2, 'easymde-immersive-workspace__ai-mode-icon', '#6848f5') + '<span data-ai-mode-label>Ask</span>' + iconMarkup('chevron-down', 14, 2) + '</button><div class="easymde-immersive-workspace__ai-menu easymde-immersive-workspace__ai-mode-menu" data-ai-menu="mode" role="listbox" aria-label="' + label('aiAssistantMode', '助手模式') + '" hidden><button type="button" role="option" class="easymde-immersive-workspace__ai-mode-option is-active" data-ai-mode="ask" aria-selected="true">' + iconMarkup('sparkles', 15, 2) + 'Ask</button><button type="button" role="option" class="easymde-immersive-workspace__ai-mode-option" data-ai-mode="agent" aria-selected="false">' + iconMarkup('bot', 15, 2) + 'Agent</button></div></div>' +
                                '<div class="easymde-immersive-workspace__ai-composer-actions"><div class="easymde-immersive-workspace__ai-config"><button type="button" class="easymde-immersive-workspace__ai-config-trigger" data-action="ai-config" aria-haspopup="menu" aria-expanded="false">' + iconMarkup('brain', 14, 2.1, '', '#7355f5') + '<span data-ai-config-label>DeepSeek-V3.2 · 标准</span>' + iconMarkup('chevron-down', 12, 2) + '</button>' +
                                    '<div class="easymde-immersive-workspace__ai-menu easymde-immersive-workspace__ai-config-menu" data-ai-menu="config" data-ai-config-menu role="menu" aria-label="' + label('aiGenerationSettings', '模型与思考设置') + '" hidden><div>' + label('aiGenerationSettings', '生成设置') + '</div><button type="button" class="easymde-immersive-workspace__ai-config-menu-item" role="menuitem" data-action="ai-open-model"><i>' + aiModelGlyphMarkup(16) + '</i><b><small>' + label('model', '模型') + '</small><strong data-ai-config-model>DeepSeek-V3.2</strong></b>' + iconMarkup('chevron-right', 15, 2, '', '#99a3b6') + '</button><button type="button" class="easymde-immersive-workspace__ai-config-menu-item" role="menuitem" data-action="ai-open-thinking"><i>' + aiThinkingDepthGlyphMarkup(16) + '</i><b><small>' + label('aiThinkingLength', '思考长度') + '</small><strong data-ai-config-thinking>标准</strong></b>' + iconMarkup('chevron-right', 15, 2, '', '#99a3b6') + '</button></div>' +
                                    '<div class="easymde-immersive-workspace__ai-menu easymde-immersive-workspace__ai-choice-menu" data-ai-menu="model" data-ai-model-menu role="listbox" aria-label="' + label('aiSelectModel', '选择模型') + '" hidden><button type="button" class="easymde-immersive-workspace__ai-menu-back" data-action="ai-config-back">' + iconMarkup('chevron-left', 15, 2) + label('aiSelectModel', '选择模型') + '</button><button type="button" role="option" class="easymde-immersive-workspace__ai-model-option is-active" data-ai-model="deepseek-v3" data-ai-model-name="DeepSeek-V3.2" aria-selected="true"><span class="easymde-immersive-workspace__ai-model-dot"></span><span>DeepSeek-V3.2</span><span class="easymde-immersive-workspace__ai-model-badge">推荐</span>' + iconMarkup('check', 14, 2, 'easymde-immersive-workspace__ai-model-check', '#6548f5') + '</button><button type="button" role="option" class="easymde-immersive-workspace__ai-model-option" data-ai-model="gpt-5-6-sol" data-ai-model-name="GPT-5.6 Sol" aria-selected="false"><span>GPT-5.6 Sol</span><span class="easymde-immersive-workspace__ai-model-badge">最新</span></button><button type="button" role="option" class="easymde-immersive-workspace__ai-model-option" data-ai-model="gpt-5-5" data-ai-model-name="GPT-5.5" aria-selected="false"><span>GPT-5.5</span></button><button type="button" role="option" class="easymde-immersive-workspace__ai-model-option" data-ai-model="gpt-5-4" data-ai-model-name="GPT-5.4" aria-selected="false"><span>GPT-5.4</span><span class="easymde-immersive-workspace__ai-model-note">将于 7 月 23 日下线</span></button><button type="button" role="option" class="easymde-immersive-workspace__ai-model-option" data-ai-model="gpt-5-3" data-ai-model-name="GPT-5.3" aria-selected="false"><span>GPT-5.3</span></button><button type="button" role="option" class="easymde-immersive-workspace__ai-model-option" data-ai-model="o3" data-ai-model-name="o3" aria-selected="false"><span>o3</span></button></div>' +
                                    '<div class="easymde-immersive-workspace__ai-menu easymde-immersive-workspace__ai-choice-menu is-thinking" data-ai-menu="thinking" data-ai-thinking-menu role="listbox" aria-label="' + label('aiThinkingLength', '思考长度') + '" hidden><button type="button" class="easymde-immersive-workspace__ai-menu-back" data-action="ai-config-back">' + iconMarkup('chevron-left', 15, 2) + label('aiThinkingLength', '思考长度') + '</button><div class="easymde-immersive-workspace__ai-thinking-options"><button type="button" role="option" class="easymde-immersive-workspace__ai-thinking-option" data-ai-thinking="off" data-ai-thinking-label="关闭" aria-selected="false"><span><span class="easymde-immersive-workspace__ai-thinking-title">关闭</span><span class="easymde-immersive-workspace__ai-thinking-note">不启用额外思考，直接生成回答</span></span></button><button type="button" role="option" class="easymde-immersive-workspace__ai-thinking-option" data-ai-thinking="short" data-ai-thinking-label="短" aria-selected="false"><span><span class="easymde-immersive-workspace__ai-thinking-title">短</span><span class="easymde-immersive-workspace__ai-thinking-note">快速响应，适合简单问题</span></span></button><button type="button" role="option" class="easymde-immersive-workspace__ai-thinking-option is-active" data-ai-thinking="standard" data-ai-thinking-label="标准" aria-selected="true"><span><span class="easymde-immersive-workspace__ai-thinking-title">标准</span><span class="easymde-immersive-workspace__ai-thinking-note">平衡速度与质量，推荐使用</span></span>' + iconMarkup('check', 15, 2, 'easymde-immersive-workspace__ai-thinking-check', '#6548f5') + '</button><button type="button" role="option" class="easymde-immersive-workspace__ai-thinking-option" data-ai-thinking="long" data-ai-thinking-label="长" aria-selected="false"><span><span class="easymde-immersive-workspace__ai-thinking-title">长</span><span class="easymde-immersive-workspace__ai-thinking-note">深度思考，适合复杂问题</span></span></button></div></div>' +
                                '</div><button type="submit" class="easymde-immersive-workspace__ai-send" data-ai-send disabled aria-label="' + label('send', 'Send') + '">' + iconMarkup('send', 16, 2.3) + '</button></div></div>' +
                        '</div>' +
                    '</form>' +
                '</aside>' +
                '<div class="easymde-immersive-workspace__table-backdrop" data-table-backdrop hidden></div>' +
                '<section class="easymde-immersive-workspace__table-modal" role="dialog" aria-modal="true" aria-labelledby="easymde-immersive-table-title" hidden>' +
                    '<header><div><strong id="easymde-immersive-table-title">' + label('insertTable', 'Insert table') + '</strong><span data-table-selection>3 × 3</span></div><button type="button" data-action="cancel-table" aria-label="' + label('close', 'Close') + '">' + iconMarkup('x', 14, 2) + '</button></header>' +
                    '<div class="easymde-immersive-workspace__table-body"><div class="easymde-immersive-workspace__table-grid" data-table-grid role="grid" aria-label="' + label('tableQuickSelect', 'Quick table size selection') + '"></div>' +
                    '<div class="easymde-immersive-workspace__table-fields"><label for="easymde-immersive-table-rows">' + label('tableRows', 'Rows') + '<input id="easymde-immersive-table-rows" name="easymde_immersive_table_rows" type="number" min="1" max="20" value="3" data-table-rows></label><span aria-hidden="true">×</span><label for="easymde-immersive-table-columns">' + label('tableColumns', 'Columns') + '<input id="easymde-immersive-table-columns" name="easymde_immersive_table_columns" type="number" min="1" max="20" value="3" data-table-columns></label></div><p class="easymde-immersive-workspace__table-error" data-table-error role="alert" hidden></p></div>' +
                    '<footer><button type="button" data-action="cancel-table">' + label('cancel', 'Cancel') + '</button><button type="button" class="is-primary" data-action="insert-table">' + label('insertTable', 'Insert table') + '</button></footer>' +
                '</section>' +
                '<div class="easymde-immersive-workspace__custom-css-backdrop" data-custom-css-backdrop hidden></div>' +
                '<section class="easymde-immersive-workspace__custom-css-modal" role="dialog" aria-modal="true" aria-labelledby="easymde-immersive-custom-css-title" hidden>' +
                    '<header>' +
                        '<div>' + iconMarkup('palette', 16, 2) + '<strong id="easymde-immersive-custom-css-title">' + label('customCssTheme', 'Custom CSS theme') + '</strong></div>' +
                        '<button type="button" data-action="close-custom-css" aria-label="' + label('close', 'Close') + '">' + iconMarkup('x', 15, 2) + '</button>' +
                    '</header>' +
                    '<div class="easymde-immersive-workspace__custom-css-body">' +
                        '<div class="easymde-immersive-workspace__custom-css-editor-pane">' +
                            '<div class="easymde-immersive-workspace__custom-css-name-wrap">' +
                                '<label for="easymde-immersive-custom-css-name">' + label('customCssThemeName', 'Theme name') + '</label>' +
                                '<input id="easymde-immersive-custom-css-name" name="easymde_immersive_custom_css_name" type="text" data-custom-css-name placeholder="' + label('customCssNamePlaceholder', 'Enter theme name…') + '">' +
                            '</div>' +
                            '<div class="easymde-immersive-workspace__custom-css-code-wrap">' +
                                '<label for="easymde-immersive-custom-css-code">' + label('customCssCode', 'CSS code') + '</label>' +
                                '<textarea id="easymde-immersive-custom-css-code" name="easymde_immersive_custom_css_code" class="easymde-immersive-workspace__custom-css-code" data-custom-css-code spellcheck="false" placeholder="' + label('customCssCodePlaceholder', '/* CSS styles */') + '"></textarea>' +
                                '<p class="easymde-immersive-workspace__custom-css-status" data-custom-css-status role="status" hidden></p>' +
                            '</div>' +
                        '</div>' +
                        '<div class="easymde-immersive-workspace__custom-css-preview">' +
                            '<div class="easymde-immersive-workspace__custom-css-preview-header">' + label('customCssStylePreview', 'Style preview') + '</div>' +
                            '<div class="easymde-immersive-workspace__custom-css-preview-scroll">' +
                                '<style data-custom-css-preview-style></style>' +
                                '<article class="easymde-immersive-workspace__custom-css-preview-content easymde-rendered-content"><div class="prose-content" data-custom-css-preview-content></div></article>' +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                    '<footer>' +
                        '<button type="button" data-action="cancel-custom-css">' + label('cancel', 'Cancel') + '</button>' +
                        '<button type="button" class="is-primary" data-action="save-custom-css" data-custom-css-save><span data-custom-css-save-label>' + label('customCssSaveTheme', 'Save theme') + '</span></button>' +
                    '</footer>' +
                '</section>' +
                '<div class="easymde-immersive-workspace__modal-backdrop" data-publish-backdrop hidden></div>' +
                '<section class="easymde-immersive-workspace__publish" role="dialog" aria-modal="true" aria-labelledby="easymde-immersive-publish-title" hidden>' +
                    '<header class="easymde-immersive-workspace__publish-header">' + publishHeaderArtMarkup() +
                        '<button type="button" class="easymde-immersive-workspace__publish-close" data-action="cancel-publish" title="' + label('close', 'Close') + '" aria-label="' + label('closePublishDialog', 'Close publish dialog') + '">' + iconMarkup('x', 14, 2.2) + '</button>' +
                        '<div class="easymde-immersive-workspace__publish-heading">' +
                            '<div class="easymde-immersive-workspace__publish-heading-icon">' + iconMarkup('square-pen', 20, 2) + '<svg class="easymde-immersive-workspace__publish-heading-sparkle" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 1.5c0 6.351 4.65 11.5 11.5 11.5-6.85 0-11.5 5.149-11.5 11.5 0-6.351-4.65-11.5-11.5-11.5C7.35 13 12 7.851 12 1.5z"></path></svg></div>' +
                            '<div class="easymde-immersive-workspace__publish-heading-copy"><div><strong id="easymde-immersive-publish-title"></strong><span data-publish-status></span></div><small data-publish-summary></small></div>' +
                        '</div>' +
                    '</header>' +
                    '<div class="easymde-immersive-workspace__publish-divider" aria-hidden="true"></div>' +
                    '<div class="easymde-immersive-workspace__publish-body">' +
                        '<div class="easymde-immersive-workspace__publish-left">' +
                            '<section class="easymde-immersive-workspace__publish-section is-tags"><div class="easymde-immersive-workspace__publish-section-title-row"><label class="easymde-immersive-workspace__publish-section-title" for="easymde-immersive-publish-tag-input">' + iconMarkup('hash', 15, 2.2) + '<span>' + label('publishTags', 'Tags') + '</span></label></div><p>' + label('publishTagsHelp', 'Press Enter or comma to add tags.') + '</p><input id="easymde-immersive-publish-tags" name="easymde_immersive_publish_tags" type="hidden" data-publish-tags><div class="easymde-immersive-workspace__publish-tagbox"><div data-publish-tag-list></div><input id="easymde-immersive-publish-tag-input" name="easymde_immersive_publish_tag_input" type="text" data-publish-tag-input autocomplete="off" placeholder="' + label('publishTagPlaceholder', 'Add tags') + '"></div></section>' +
                            '<section class="easymde-immersive-workspace__publish-section is-excerpt"><div class="easymde-immersive-workspace__publish-section-heading"><label class="easymde-immersive-workspace__publish-section-title" for="easymde-immersive-publish-excerpt">' + iconMarkup('file-text', 15, 2.2) + '<span>' + label('publishExcerpt', 'Summary') + '</span></label><div class="easymde-immersive-workspace__publish-excerpt-meta"><button type="button" class="easymde-immersive-workspace__publish-ai-summary" data-action="ai-generate-summary">' + iconMarkup('sparkles', 11, 2.4) + '<span>' + label('publishAiSummary', 'Generate summary with AI') + '</span></button><span data-publish-excerpt-count>0 / 160</span></div></div><textarea id="easymde-immersive-publish-excerpt" name="easymde_immersive_publish_excerpt" rows="4" maxlength="160" data-publish-excerpt placeholder="' + label('publishExcerptPlaceholder', 'Write a short summary for search results, article lists, and sharing previews...') + '"></textarea></section>' +
                            '<section class="easymde-immersive-workspace__publish-section is-categories"><div class="easymde-immersive-workspace__publish-section-heading"><strong class="easymde-immersive-workspace__publish-section-title">' + iconMarkup('list-checks', 15, 2.2) + '<span>' + label('publishCategories', 'Categories') + '</span></strong><span data-publish-category-count></span></div><p>' + label('publishCategoriesHelp', 'Choose the sections this article belongs to.') + '</p><div class="easymde-immersive-workspace__categories"><div class="easymde-immersive-workspace__categories-scroll" data-publish-categories></div></div></section>' +
                        '</div>' +
                        '<aside class="easymde-immersive-workspace__publish-right">' +
                            '<section class="easymde-immersive-workspace__publish-section is-featured"><div class="easymde-immersive-workspace__publish-section-title-row"><strong class="easymde-immersive-workspace__publish-section-title"><span>' + label('publishFeaturedImage', 'Featured image') + '</span></strong></div><span class="easymde-immersive-workspace__featured-summary" data-featured-summary></span><button type="button" class="easymde-immersive-workspace__featured-empty" data-action="select-featured" data-featured-empty>' + publishFeaturedPlaceholderMarkup() + '<b>' + label('selectFeaturedImage', 'Select featured image') + '</b><span>' + label('featuredLandscapeHelp', 'Landscape images work best') + '</span><small>' + label('featuredFormatsHelp', 'Supports JPG, PNG, and WebP up to 5MB') + '</small></button><div class="easymde-immersive-workspace__featured-selected" data-featured-selected hidden><div><img data-featured-image alt=""></div><footer><button type="button" data-action="select-featured">' + label('replaceFeaturedImage', 'Replace') + '</button><button type="button" data-action="remove-featured">' + iconMarkup('trash-2', 12, 2) + label('removeFeaturedImage', 'Remove') + '</button></footer></div></section>' +
                            '<section class="easymde-immersive-workspace__publish-visibility"><div class="easymde-immersive-workspace__publish-visibility-title">' + iconMarkup('eye', 16, 2) + '<strong>' + label('publishVisibility', 'Visibility') + '</strong></div><div class="easymde-immersive-workspace__publish-visibility-options" role="radiogroup" aria-label="' + label('publishVisibility', 'Visibility') + '"><label class="easymde-immersive-workspace__publish-visibility-option"><input type="radio" name="easymde_immersive_publish_visibility" value="public" data-publish-visibility="public"><span class="easymde-immersive-workspace__publish-radio" aria-hidden="true"><i></i></span>' + label('publishVisibilityPublic', 'Public') + '</label><label class="easymde-immersive-workspace__publish-visibility-option"><input type="radio" name="easymde_immersive_publish_visibility" value="password" data-publish-visibility="password"><span class="easymde-immersive-workspace__publish-radio" aria-hidden="true"><i></i></span>' + label('publishVisibilityPassword', 'Password') + '</label><label class="easymde-immersive-workspace__publish-visibility-option"><input type="radio" name="easymde_immersive_publish_visibility" value="private" data-publish-visibility="private"><span class="easymde-immersive-workspace__publish-radio" aria-hidden="true"><i></i></span>' + label('publishVisibilityPrivate', 'Private') + '</label></div><label class="easymde-immersive-workspace__publish-sticky" data-publish-sticky-row><input id="easymde-immersive-publish-sticky" name="easymde_immersive_publish_sticky" type="checkbox" data-publish-sticky aria-label="' + label('publishSticky', 'Stick to the top of the front page') + '"><span class="easymde-immersive-workspace__publish-sticky-box" aria-hidden="true">' + iconMarkup('check', 10, 3.2) + '</span>' + label('publishSticky', 'Stick to the top of the front page') + '</label><div class="easymde-immersive-workspace__publish-password" data-publish-password-row hidden><label for="easymde-immersive-publish-password">' + label('publishPassword', 'Access password') + '</label><input id="easymde-immersive-publish-password" name="easymde_immersive_publish_password" type="password" maxlength="255" data-publish-password placeholder="' + label('publishPasswordPlaceholder', 'Enter an access password') + '"><p id="easymde-immersive-publish-password-error" data-publish-password-error role="alert" hidden></p></div><p class="easymde-immersive-workspace__publish-private-help" data-publish-private-help hidden>' + label('publishPrivateHelp', 'Only site administrators and editors can view this article.') + '</p></section>' +
                            '<section class="easymde-immersive-workspace__publish-options"><div class="easymde-immersive-workspace__publish-options-title">' + iconMarkup('calendar-check', 16, 2) + '<strong>' + label('publishOptions', 'Publish options') + '</strong></div><label class="easymde-immersive-workspace__publish-preview"><div class="easymde-immersive-workspace__publish-preview-copy"><b data-publish-preview-label>' + label('publishPreviewAfter', 'Open preview after publishing') + '</b><small>' + label('publishPreviewHelp', 'Open the article preview in a new page after submission.') + '</small></div><span class="easymde-immersive-workspace__publish-preview-switch"><input id="easymde-immersive-publish-preview" name="easymde_immersive_publish_preview" type="checkbox" role="switch" data-publish-preview aria-label="' + label('publishPreviewAfter', 'Open preview after publishing') + '"><i aria-hidden="true"><span data-publish-preview-thumb></span></i></span></label></section>' +
                        '</aside>' +
                    '</div>' +
                    '<div class="easymde-immersive-workspace__publish-divider" aria-hidden="true"></div>' +
                    '<footer><div class="easymde-immersive-workspace__publish-safety"><span>' + iconMarkup('shield-check', 12, 2.2) + '</span>' + label('publishZeroWriteHelp', 'Nothing is written to WordPress before submission.') + '</div><div class="easymde-immersive-workspace__publish-progress" data-publish-progress aria-live="polite"></div><div class="easymde-immersive-workspace__publish-footer-actions"><button type="button" data-action="cancel-publish">' + label('cancel', 'Cancel') + '</button><button type="button" data-action="confirm-publish" class="is-primary" data-publish-confirm>' + '<span data-publish-confirm-label></span>' + publishButtonSparklesMarkup() + '</button></div></footer>' +
                '</section>' +
                '<div class="easymde-immersive-workspace__history-backdrop" data-history-backdrop hidden></div>' +
                '<section class="easymde-immersive-workspace__history" role="dialog" aria-modal="true" aria-labelledby="easymde-immersive-history-title" hidden>' +
                    '<aside class="easymde-immersive-workspace__history-sidebar">' +
                        '<div class="easymde-immersive-workspace__history-sidebar-header"><div><strong id="easymde-immersive-history-title">' + label('historyVersions', 'Version history') + '</strong>' + iconMarkup('info', 13, 2) + '</div><button type="button" data-action="close-history" aria-label="' + label('close', 'Close') + '">' + iconMarkup('x', 14, 2) + '</button></div>' +
                        '<div class="easymde-immersive-workspace__history-summary"><span data-history-count></span><div class="easymde-immersive-workspace__history-filter"><button type="button" data-action="history-filter" aria-expanded="false"><span data-history-filter-label>' + label('historyFilterAll', 'All') + '</span>' + iconMarkup('chevron-down', 10, 2.5) + '</button><div class="easymde-immersive-workspace__history-filter-menu" role="menu" hidden><button type="button" role="menuitemradio" data-history-filter="all">' + label('historyFilterAll', 'All') + '</button><button type="button" role="menuitemradio" data-history-filter="auto">' + label('historyAutoSave', 'Auto save') + '</button><button type="button" role="menuitemradio" data-history-filter="manual">' + label('historyManualSave', 'Manual save') + '</button></div></div></div>' +
                        '<div class="easymde-immersive-workspace__history-separator" aria-hidden="true"></div>' +
                        '<div class="easymde-immersive-workspace__history-list" data-history-list></div>' +
                    '</aside>' +
                    '<div class="easymde-immersive-workspace__history-detail">' +
                        '<header class="easymde-immersive-workspace__history-detail-header"><div><strong data-history-selected-label></strong><span data-history-selected-date></span></div><button type="button" class="easymde-immersive-workspace__history-restore" data-action="restore-history" disabled>' + iconMarkup('rotate-ccw', 12, 2.5) + '<span>' + label('historyRestore', 'Restore this version') + '</span></button></header>' +
                        '<div class="easymde-immersive-workspace__history-preview-scroll"><article class="easymde-immersive-workspace__history-preview" data-history-preview></article></div>' +
                    '</div>' +
                '</section>' +
            '</div>';
    }

    function createController(options) {
        var adapter = options && options.adapter ? options.adapter : {};
        var doc = options && options.document ? options.document : document;
        var win = options && options.window ? options.window : window;
        var strings = options && options.strings ? options.strings : {};
        var layoutKey = options && options.layoutKey ? String(options.layoutKey) : '';
        var root = null;
        var source = null;
        var title = null;
        var preview = null;
        var main = null;
        var toolbar = null;
        var outlineNode = null;
        var statsNode = null;
        var cursorNode = null;
        var divider = null;
        var outlineResizer = null;
        var lineNumbers = null;
        var sourceHighlight = null;
        var previousFocus = null;
        var previousScroll = null;
        var previousWpWrapInert = false;
        var previousWpWrapHadInert = false;
        var sourceRatio = 0.5;
        var outlineWidth = OUTLINE_DEFAULT_WIDTH;
        var outlineResizeCleanup = null;
        var listeners = [];
        var composingTitle = false;
        var viewMode = 'split';
        var outlineEnabled = true;
        var outlineVisible = false;
        var activeOutlineKey = '';
        var publishDraft = null;
        var publishState = null;
        var publishSequence = 0;
        var publishSubmitting = false;
        var publishCategoryCollapsed = Object.create(null);
        var featuredImageTouched = false;
        var syncScroll = true;
        var scrollLock = false;
        var derivedFrame = null;
        var derivedFrameIsTimeout = false;
        var renderedLineCount = 0;
        var popoverTrigger = null;
        var customCssState = null;
        var customCssPreviewSequence = 0;
        var customCssPreviewTimer = null;
        var customCssSavedTimer = null;
        var customCssReturnFocus = null;
        var customCssSubmitting = false;
        var customCssPreviewValid = false;
        var historyEntries = [];
        var historyFilter = 'all';
        var historySelectedId = 0;
        var historySequence = 0;
        var historyDetailSequence = 0;
        var historyReturnFocus = null;
        var aiMessages = [];
        var aiModel = 'deepseek-v3';
        var aiMode = 'ask';
        var aiThinkingLength = 'standard';
        var aiPinned = false;
        var aiOpenMenu = null;
        var aiMenuReturnFocus = null;
        var aiReturnFocus = null;
        var tableReturnFocus = null;
        var wechatCopying = false;
        var wechatFeedbackTimer = null;

        function listen(node, type, handler, settings) {
            if (!node || !node.addEventListener) {
                return;
            }
            node.addEventListener(type, handler, settings);
            listeners.push(function () {
                node.removeEventListener(type, handler, settings);
            });
        }

        function query(selector) {
            return root ? root.querySelector(selector) : null;
        }

        function updateTitleHeight() {
            var lineHeight;
            var measuredHeight;
            var mirror;
            if (!title || !title.style) {
                return;
            }
            mirror = query('[data-title-mirror]');
            if (mirror) {
                mirror.textContent = title.value || title.getAttribute('placeholder') || '';
            }
            title.style.height = '0px';
            lineHeight = win.getComputedStyle ? parseFloat(win.getComputedStyle(title).lineHeight) : 0;
            measuredHeight = title.scrollHeight || 34;
            title.style.height = String(lineHeight && measuredHeight <= Math.ceil(lineHeight) ? lineHeight : measuredHeight) + 'px';
        }

        function syncExternalTitle(value) {
            var normalized = normalizeTitle(value);
            if (!title || composingTitle || title.value === normalized) {
                return;
            }
            title.value = normalized;
            updateTitleHeight();
            renderOutline();
        }

        function updateStats() {
            var stats = calculateStats(source ? source.value : '');
            var values = {
                'read-minutes': stats.readMinutes,
                lines: stats.lines,
                words: stats.words,
                cjk: stats.cjk,
                characters: stats.characters
            };

            if (statsNode) {
                statsNode.querySelectorAll('[data-stat]').forEach(function (node) {
                    node.textContent = String(values[node.getAttribute('data-stat')] || 0);
                });
            }
            if (!root) {
                return;
            }
            root.querySelectorAll('[data-stat-summary]').forEach(function (node) {
                node.textContent = String(values[node.getAttribute('data-stat-summary')] || 0);
            });
        }

        function updateCursor() {
            var before;
            var lines;
            var line;
            var column;
            if (!source || !cursorNode) {
                return;
            }
            before = source.value.slice(0, source.selectionStart || 0);
            lines = before.split('\n');
            line = lines.length;
            column = lines[lines.length - 1].length + 1;
            cursorNode.textContent = (strings.line || 'Line') + ' ' + line + ', ' + (strings.column || 'Column') + ' ' + column;
        }

        function updateLineNumbers() {
            var count;
            var fragment;
            var index;

            if (!lineNumbers || !source) {
                return;
            }

            count = normalizeLineEndings(source.value).split('\n').length;
            if (count === renderedLineCount) {
                return;
            }
            renderedLineCount = count;
            fragment = doc.createDocumentFragment();
            for (index = 1; index <= count; index += 1) {
                var number = doc.createElement('span');
                number.className = 'easymde-immersive-workspace__line-number';
                number.textContent = String(index);
                fragment.appendChild(number);
            }
            lineNumbers.textContent = '';
            lineNumbers.appendChild(fragment);
        }

        function appendInlineHighlight(container, text) {
            var expression = /(`[^`]*`|\*\*[^*]+\*\*|~~[^~]+~~|\[[^\]]+\]\([^)]*\))/g;
            var offset = 0;
            var match;

            while ((match = expression.exec(text)) !== null) {
                if (match.index > offset) {
                    container.appendChild(doc.createTextNode(text.slice(offset, match.index)));
                }
                var token = doc.createElement('span');
                token.className = match[0].charAt(0) === '`'
                    ? 'is-code'
                    : (match[0].slice(0, 2) === '**' ? 'is-strong' : 'is-link');
                token.textContent = match[0];
                container.appendChild(token);
                offset = expression.lastIndex;
            }

            if (offset < text.length) {
                container.appendChild(doc.createTextNode(text.slice(offset)));
            }
        }

        function renderSourceHighlight() {
            var lines;
            var fragment;
            var inFence = false;

            if (!sourceHighlight || !source) {
                return;
            }

            lines = normalizeLineEndings(source.value).split('\n');
            fragment = doc.createDocumentFragment();
            lines.forEach(function (line, index) {
                var lineNode = doc.createElement('span');
                var heading = line.match(/^(\s*)(#{1,6})(\s+)(.*)$/);

                lineNode.className = 'easymde-immersive-workspace__source-line';
                if (/^\s*```/.test(line)) {
                    inFence = !inFence;
                    lineNode.classList.add('is-muted');
                    lineNode.textContent = line;
                } else if (inFence) {
                    lineNode.textContent = line;
                } else if (heading) {
                    lineNode.appendChild(doc.createTextNode(heading[1]));
                    var marker = doc.createElement('span');
                    marker.className = 'is-heading-marker';
                    marker.textContent = heading[2];
                    lineNode.appendChild(marker);
                    lineNode.appendChild(doc.createTextNode(heading[3]));
                    var headingText = doc.createElement('span');
                    headingText.className = 'is-heading-text';
                    appendInlineHighlight(headingText, heading[4]);
                    lineNode.appendChild(headingText);
                } else if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
                    lineNode.classList.add('is-rule');
                    lineNode.textContent = line;
                } else if (/^\s*>/.test(line)) {
                    lineNode.classList.add('is-muted');
                    lineNode.textContent = line;
                } else {
                    appendInlineHighlight(lineNode, line);
                }
                fragment.appendChild(lineNode);
                if (index < lines.length - 1 || source.value.slice(-1) !== '\n') {
                    fragment.appendChild(doc.createTextNode('\n'));
                }
            });
            sourceHighlight.textContent = '';
            sourceHighlight.appendChild(fragment);
            sourceHighlight.scrollTop = source.scrollTop;
            sourceHighlight.scrollLeft = source.scrollLeft;
        }

        function renderOutline() {
            var entries = parseOutline(source ? source.value : '');
            var roots = [];
            var stack = [];

            function appendTree(nodes, parent, depth) {
                var branch = doc.createElement('div');
                branch.className = depth === 0
                    ? 'easymde-immersive-workspace__outline-tree'
                    : 'easymde-immersive-workspace__outline-children';
                nodes.forEach(function (node) {
                    var entry = node.entry;
                    var item = doc.createElement('div');
                    var button = doc.createElement('button');
                    var marker = doc.createElement('span');
                    var textNode = doc.createElement('span');
                    var numberedTitle = depth === 0 ? entry.text.match(/^(\d+\.)\s*(.*)$/) : null;

                    item.className = 'easymde-immersive-workspace__outline-item';
                    button.type = 'button';
                    button.className = 'easymde-immersive-workspace__outline-entry';
                    button.setAttribute('data-outline-level', String(entry.level));
                    if (depth === 0) {
                        button.classList.add('is-top-level');
                    }
                    if (entry.key === activeOutlineKey) {
                        button.classList.add('is-active');
                        button.setAttribute('aria-current', 'location');
                    }
                    marker.className = depth === 0
                        ? 'easymde-immersive-workspace__outline-icon'
                        : 'easymde-immersive-workspace__outline-connector';
                    marker.setAttribute('aria-hidden', 'true');
                    if (depth === 0) {
                        marker.innerHTML = iconMarkup(getOutlineIconName(entry.text), 15, 2);
                    } else {
                        marker.textContent = '\u2014';
                    }
                    textNode.className = 'easymde-immersive-workspace__outline-text';
                    if (numberedTitle) {
                        var numberNode = doc.createElement('span');
                        var labelNode = doc.createElement('span');
                        numberNode.className = 'easymde-immersive-workspace__outline-number';
                        numberNode.textContent = numberedTitle[1];
                        labelNode.textContent = numberedTitle[2];
                        textNode.appendChild(numberNode);
                        textNode.appendChild(doc.createTextNode(' '));
                        textNode.appendChild(labelNode);
                    } else {
                        textNode.textContent = entry.text;
                    }
                    button.appendChild(marker);
                    button.appendChild(textNode);
                    button.setAttribute('data-offset', String(entry.offset));
                    button.setAttribute('data-outline-key', entry.key);
                    button.setAttribute('data-outline-index', String(node.index));
                    item.appendChild(button);
                    if (node.children.length) {
                        appendTree(node.children, item, depth + 1);
                    }
                    branch.appendChild(item);
                });
                parent.appendChild(branch);
            }

            if (!outlineNode) {
                return;
            }
            outlineNode.textContent = '';
            if (!entries.length) {
                var empty = doc.createElement('p');
                empty.className = 'easymde-immersive-workspace__outline-empty';
                empty.textContent = strings.noOutline || 'No headings yet';
                outlineNode.appendChild(empty);
                return;
            }
            entries.forEach(function (entry, entryIndex) {
                var node = { children: [], entry: entry, index: entryIndex };
                if (entry.depth === 0) {
                    roots.push(node);
                } else {
                    stack[entry.depth - 1].children.push(node);
                }
                stack[entry.depth] = node;
                stack.length = entry.depth + 1;
            });
            appendTree(roots, outlineNode, 0);
        }

        function refreshPreview(immediate) {
            if (typeof adapter.renderPreview === 'function') {
                adapter.renderPreview(preview, source.value, { immediate: immediate === true });
                return;
            }
            preview.textContent = source.value;
        }

        function renderDocumentDerivedState(immediate) {
            updateStats();
            updateCursor();
            updateLineNumbers();
            renderSourceHighlight();
            renderOutline();
            refreshPreview(immediate);
        }

        function cancelDocumentDerivedState() {
            if (derivedFrame === null) {
                return;
            }
            if (derivedFrameIsTimeout) {
                win.clearTimeout(derivedFrame);
            } else if (typeof win.cancelAnimationFrame === 'function') {
                win.cancelAnimationFrame(derivedFrame);
            }
            derivedFrame = null;
            derivedFrameIsTimeout = false;
        }

        function updateDocumentDerivedState(immediate) {
            if (immediate === true) {
                cancelDocumentDerivedState();
                renderDocumentDerivedState(true);
                return;
            }
            if (derivedFrame !== null) {
                return;
            }
            derivedFrameIsTimeout = typeof win.requestAnimationFrame !== 'function';
            derivedFrame = derivedFrameIsTimeout
                ? win.setTimeout(function () {
                    derivedFrame = null;
                    derivedFrameIsTimeout = false;
                    if (root) {
                        renderDocumentDerivedState(false);
                    }
                }, 16)
                : win.requestAnimationFrame(function () {
                    derivedFrame = null;
                    if (root) {
                        renderDocumentDerivedState(false);
                    }
                });
        }

        function setView(mode) {
            if (['edit', 'split', 'preview'].indexOf(mode) === -1) {
                return;
            }
            viewMode = mode;
            main.setAttribute('data-view', mode);
            toolbar.hidden = mode === 'preview';
            root.querySelectorAll('[data-view]').forEach(function (button) {
                if (button.tagName === 'BUTTON') {
                    button.classList.toggle('is-active', button.getAttribute('data-view') === mode);
                }
            });
            setSettingSwitch('split', mode === 'split');
        }

        function setSourceRatio(ratio) {
            sourceRatio = clampSourceRatio(ratio);
            main.style.setProperty('--easymde-immersive-source-ratio', String(sourceRatio));
            divider.setAttribute('aria-valuenow', String(Math.round(sourceRatio * 100)));
        }

        function setOutlineWidth(width) {
            outlineWidth = clampOutlineWidth(width);
            main.style.setProperty('--easymde-immersive-outline-width', String(outlineWidth) + 'px');
            outlineResizer.setAttribute('aria-valuenow', String(Math.round(outlineWidth)));
        }

        function layoutStorage() {
            try {
                return options && options.storage ? options.storage : win.localStorage;
            } catch (error) {
                return null;
            }
        }

        function restoreSourceRatio() {
            var storage = layoutStorage();
            var stored;
            if (!storage || !layoutKey) {
                return 0.5;
            }
            try {
                stored = parseFloat(storage.getItem(layoutKey));
            } catch (error) {
                return 0.5;
            }
            return isFinite(stored) ? stored : 0.5;
        }

        function persistSourceRatio() {
            var storage = layoutStorage();
            if (!storage || !layoutKey) {
                return;
            }
            try {
                storage.setItem(layoutKey, String(sourceRatio));
            } catch (error) {
                // Layout preference is optional and must never block writing.
            }
        }

        function restoreOutlineWidth() {
            var storage = layoutStorage();
            var stored;

            if (!storage || !layoutKey) {
                return OUTLINE_DEFAULT_WIDTH;
            }
            try {
                stored = storage.getItem(layoutKey + ':outline-width');
            } catch (error) {
                return OUTLINE_DEFAULT_WIDTH;
            }
            return clampOutlineWidth(stored === null ? OUTLINE_DEFAULT_WIDTH : stored);
        }

        function persistOutlineWidth() {
            var storage = layoutStorage();

            if (!storage || !layoutKey) {
                return;
            }
            try {
                storage.setItem(layoutKey + ':outline-width', String(outlineWidth));
            } catch (error) {
                // Layout preference is optional and contains no document data.
            }
        }

        function bindOutlineResizer() {
            var pointerId = null;
            var startX = 0;
            var startWidth = OUTLINE_DEFAULT_WIDTH;
            var previousCursor = '';
            var previousUserSelect = '';

            function finishResize(shouldPersist) {
                if (pointerId === null && !outlineResizeCleanup) {
                    return;
                }
                pointerId = null;
                outlineResizer.classList.remove('is-dragging');
                doc.body.style.cursor = previousCursor;
                doc.body.style.userSelect = previousUserSelect;
                outlineResizeCleanup = null;
                if (shouldPersist) {
                    persistOutlineWidth();
                }
            }

            outlineResizeCleanup = null;
            listen(outlineResizer, 'pointerdown', function (event) {
                if (!outlineEnabled || !outlineVisible) {
                    return;
                }
                pointerId = event.pointerId;
                startX = event.clientX;
                startWidth = outlineWidth;
                previousCursor = doc.body.style.cursor;
                previousUserSelect = doc.body.style.userSelect;
                doc.body.style.cursor = 'col-resize';
                doc.body.style.userSelect = 'none';
                outlineResizer.classList.add('is-dragging');
                outlineResizeCleanup = function () { finishResize(false); };
                if (outlineResizer.setPointerCapture) {
                    outlineResizer.setPointerCapture(pointerId);
                }
                event.preventDefault();
            });
            listen(outlineResizer, 'pointermove', function (event) {
                if (pointerId === null || event.pointerId !== pointerId) {
                    return;
                }
                setOutlineWidth(startWidth + event.clientX - startX);
            });
            listen(outlineResizer, 'pointerup', function (event) {
                if (event.pointerId === pointerId) {
                    finishResize(true);
                }
            });
            listen(outlineResizer, 'pointercancel', function (event) {
                if (event.pointerId === pointerId) {
                    finishResize(false);
                }
            });
            listen(outlineResizer, 'lostpointercapture', function () {
                finishResize(false);
            });
            listen(outlineResizer, 'keydown', function (event) {
                var step = event.shiftKey ? 20 : 10;

                if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                    setOutlineWidth(outlineWidth + (event.key === 'ArrowLeft' ? -step : step));
                } else if (event.key === 'Home' || event.key === 'End') {
                    setOutlineWidth(event.key === 'Home' ? OUTLINE_MIN_WIDTH : OUTLINE_MAX_WIDTH);
                } else {
                    return;
                }
                persistOutlineWidth();
                event.preventDefault();
            });
            listen(outlineResizer, 'dblclick', function (event) {
                setOutlineWidth(OUTLINE_DEFAULT_WIDTH);
                persistOutlineWidth();
                event.preventDefault();
            });
            listen(win, 'resize', function () {
                setOutlineWidth(outlineWidth);
            });
        }

        function bindDivider() {
            var pointerId = null;
            var pointerMetrics = null;

            listen(divider, 'pointerdown', function (event) {
                var dividerRect = divider.getBoundingClientRect();
                var previewRect = query('.easymde-immersive-workspace__preview-card').getBoundingClientRect();
                var sourceRect = query('.easymde-immersive-workspace__editor-card').getBoundingClientRect();

                pointerId = event.pointerId;
                pointerMetrics = {
                    dividerWidth: dividerRect.width,
                    gap: dividerRect.left - sourceRect.right,
                    pointerOffset: event.clientX - dividerRect.left,
                    previewRight: previewRect.right,
                    sourceLeft: sourceRect.left
                };
                if (divider.setPointerCapture) {
                    divider.setPointerCapture(pointerId);
                }
                event.preventDefault();
            });
            listen(divider, 'pointermove', function (event) {
                if (pointerId === null || event.pointerId !== pointerId || !pointerMetrics) {
                    return;
                }
                setSourceRatio(calculateSourceRatioFromPointer(event.clientX, pointerMetrics));
            });
            listen(divider, 'pointerup', function (event) {
                if (event.pointerId === pointerId) {
                    pointerId = null;
                    pointerMetrics = null;
                    persistSourceRatio();
                }
            });
            listen(divider, 'pointercancel', function (event) {
                if (event.pointerId === pointerId) {
                    pointerId = null;
                    pointerMetrics = null;
                }
            });
            listen(divider, 'lostpointercapture', function () {
                pointerId = null;
                pointerMetrics = null;
            });
            listen(divider, 'keydown', function (event) {
                if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                    setSourceRatio(sourceRatio + (event.key === 'ArrowLeft' ? -0.025 : 0.025));
                    persistSourceRatio();
                    event.preventDefault();
                } else if (event.key === 'Home' || event.key === 'End') {
                    setSourceRatio(event.key === 'Home' ? 0.25 : 0.75);
                    persistSourceRatio();
                    event.preventDefault();
                }
            });
            listen(win, 'resize', function () {
                setSourceRatio(sourceRatio);
                updateTitleHeight();
            });
        }

        function closePopovers(restoreFocus) {
            var trigger = popoverTrigger;
            closeFontSelectMenus(root, null, false);
            root.querySelectorAll('.easymde-immersive-workspace__popover').forEach(function (node) {
                node.hidden = true;
            });
            root.querySelectorAll('[data-action="settings"], [data-action="statistics"], [data-action="theme"], [data-action="font"]').forEach(function (node) {
                node.setAttribute('aria-expanded', 'false');
            });
            popoverTrigger = null;
            if (restoreFocus && trigger && trigger.isConnected && trigger.focus) {
                trigger.focus();
            }
        }

        function openPopover(popover, trigger) {
            closePopovers(false);
            if (!popover) {
                return;
            }
            popoverTrigger = trigger || null;
            popover.hidden = false;
            if (popoverTrigger) {
                popoverTrigger.setAttribute('aria-expanded', 'true');
            }
            positionSettingsPopover();
            positionAppearancePopover();
        }

        function positionSettingsPopover() {
            var popover = query('[data-popover="settings"]');
            var rect;
            var tailRight;

            if (!popover || popover.hidden || !popoverTrigger || !popoverTrigger.getBoundingClientRect) {
                return;
            }

            rect = popoverTrigger.getBoundingClientRect();
            tailRight = Math.max(14, Math.min(22, (rect.width / 2) - 6));
            popover.style.top = String(rect.bottom + 10) + 'px';
            popover.style.right = String(Math.max(0, win.innerWidth - rect.right)) + 'px';
            popover.style.setProperty('--easymde-settings-tail-right', String(tailRight) + 'px');
        }

        function positionAppearancePopover() {
            var popover = query('[data-popover="appearance"]');
            var rect;

            if (!popover || popover.hidden || !popoverTrigger || !popoverTrigger.getBoundingClientRect) {
                return;
            }

            rect = popoverTrigger.getBoundingClientRect();
            popover.style.top = String(rect.bottom + 8) + 'px';
            popover.style.right = String(Math.max(0, win.innerWidth - rect.right)) + 'px';
        }

        function setSettingSwitch(setting, enabled) {
            var button = query('[data-setting="' + setting + '"]');
            var check;
            if (button) {
                button.setAttribute('aria-checked', enabled ? 'true' : 'false');
                check = button.querySelector('.easymde-immersive-workspace__settings-check');
                if (check) {
                    check.innerHTML = enabled ? iconMarkup('check', 20, 2.8) : '';
                }
            }
        }

        function setWordCountVisible(visible) {
            var statisticsButton = query('[data-action="statistics"]');
            var statisticsPopover = query('[data-popover="statistics"]');

            setSettingSwitch('word-count', !!visible);
            if (statisticsButton) {
                statisticsButton.hidden = !visible;
                if (!visible) {
                    statisticsButton.setAttribute('aria-expanded', 'false');
                }
            }
            if (!visible && statisticsPopover) {
                statisticsPopover.hidden = true;
                if (popoverTrigger === statisticsButton) {
                    popoverTrigger = null;
                }
            }
        }

        function setLocalDraftsStatus(enabled, notifyAdapter) {
            var actual = !!enabled;
            var status = query('[data-local-drafts-status]');

            if (notifyAdapter && typeof adapter.setLocalDraftsEnabled === 'function') {
                actual = !!adapter.setLocalDraftsEnabled(actual);
            }

            setSettingSwitch('auto-save', actual);
            if (status) {
                status.hidden = !actual;
            }
            return actual;
        }

        function setSyncScrollEnabled(enabled) {
            syncScroll = !!enabled;
            setSettingSwitch('sync', syncScroll);
        }

        function renderOutlineState() {
            var expanded = outlineEnabled && outlineVisible;
            root.classList.toggle('is-outline-disabled', !outlineEnabled);
            root.classList.toggle('is-outline-hidden', outlineEnabled && !outlineVisible);
            setSettingSwitch('outline', outlineEnabled);
            root.querySelectorAll('[data-action="toggle-outline"]').forEach(function (button) {
                button.setAttribute('aria-expanded', expanded ? 'true' : 'false');
            });
            if (outlineResizer) {
                outlineResizer.setAttribute('aria-hidden', expanded ? 'false' : 'true');
                outlineResizer.tabIndex = expanded ? 0 : -1;
            }
        }

        function setOutlineVisible(visible) {
            outlineVisible = !!visible;
            renderOutlineState();
        }

        function setOutlineEnabled(enabled) {
            outlineEnabled = !!enabled;
            renderOutlineState();
        }

        function closeFontSelectMenu(menu, restoreFocus) {
            var trigger;

            if (!menu) {
                return;
            }

            trigger = menu.parentNode
                ? menu.parentNode.querySelector('.easymde-immersive-workspace__font-select-trigger')
                : null;
            menu.hidden = true;
            if (menu.previousElementSibling && menu.previousElementSibling.classList.contains('easymde-immersive-workspace__font-select-backdrop')) {
                menu.previousElementSibling.hidden = true;
            }
            if (trigger) {
                trigger.setAttribute('aria-expanded', 'false');
                if (restoreFocus && trigger.focus) {
                    trigger.focus();
                }
            }
        }

        function closeFontSelectMenus(container, exceptMenu, restoreFocus) {
            if (!container || !container.querySelectorAll) {
                return;
            }

            container.querySelectorAll('.easymde-immersive-workspace__font-select-menu').forEach(function (menu) {
                if (menu !== exceptMenu) {
                    closeFontSelectMenu(menu, !!restoreFocus);
                }
            });
        }

        function appendAppearanceSelect(container, labelText, key, options, selected) {
            var row = doc.createElement('div');
            var labelNode = doc.createElement('span');
            var select = doc.createElement('div');
            var trigger = doc.createElement('button');
            var value = doc.createElement('span');
            var menuBackdrop = doc.createElement('span');
            var menu = doc.createElement('div');
            var fieldKey = String(key || '').replace(/([A-Z])/g, '-$1').toLowerCase();
            var normalizedOptions = options || [];
            var selectedOption = normalizedOptions.find(function (option) {
                return String(option.id || '') === String(selected || '');
            }) || normalizedOptions[0] || { id: '', label: '\u2014', fontFamily: 'inherit' };

            function setTriggerValue(option) {
                value.textContent = String(option.label || option.id || '\u2014');
                trigger.style.fontFamily = option.fontFamily ? String(option.fontFamily) : 'inherit';
                trigger.style.fontWeight = option.fontWeight !== undefined && option.fontWeight !== null
                    ? String(option.fontWeight)
                    : '';
            }

            function setSelectedOption(option) {
                selectedOption = option;
                setTriggerValue(option);
                menu.querySelectorAll('.easymde-immersive-workspace__font-option').forEach(function (button) {
                    var active = button.getAttribute('data-appearance-value') === String(option.id || '');
                    var check = button.querySelector('.easymde-immersive-workspace__font-check');
                    button.setAttribute('aria-selected', active ? 'true' : 'false');
                    if (check) {
                        check.innerHTML = active ? iconMarkup('check', 11, 2) : '';
                    }
                });
            }

            function focusMenuOption(position) {
                var buttons = menu.querySelectorAll('.easymde-immersive-workspace__font-option');
                var index = position;

                if (!buttons.length) {
                    return;
                }
                if (position === 'selected') {
                    index = normalizedOptions.indexOf(selectedOption);
                } else if (position === 'last') {
                    index = buttons.length - 1;
                }
                index = Math.max(0, Math.min(buttons.length - 1, Number(index) || 0));
                buttons[index].focus();
            }

            function openMenu(focusPosition) {
                closeFontSelectMenus(container, menu, false);
                menuBackdrop.hidden = false;
                menu.hidden = false;
                trigger.setAttribute('aria-expanded', 'true');
                if (focusPosition !== undefined) {
                    focusMenuOption(focusPosition);
                }
            }

            row.className = 'easymde-immersive-workspace__font-row';
            labelNode.id = 'easymde-immersive-font-label-' + fieldKey;
            labelNode.className = 'easymde-immersive-workspace__font-label';
            labelNode.textContent = labelText;
            select.className = 'easymde-immersive-workspace__font-select';
            trigger.id = 'easymde-immersive-font-trigger-' + fieldKey;
            trigger.type = 'button';
            trigger.className = 'easymde-immersive-workspace__font-select-trigger';
            trigger.setAttribute('data-appearance-key', key);
            trigger.setAttribute('aria-haspopup', 'listbox');
            trigger.setAttribute('aria-expanded', 'false');
            trigger.setAttribute('aria-labelledby', labelNode.id + ' ' + trigger.id + '-value');
            trigger.setAttribute('aria-controls', 'easymde-immersive-font-menu-' + fieldKey);
            value.id = trigger.id + '-value';
            value.className = 'easymde-immersive-workspace__font-select-value';
            setTriggerValue(selectedOption);
            trigger.appendChild(value);
            trigger.insertAdjacentHTML('beforeend', iconMarkup('chevron-down', 12, 2));

            menuBackdrop.className = 'easymde-immersive-workspace__font-select-backdrop';
            menuBackdrop.setAttribute('aria-hidden', 'true');
            menuBackdrop.hidden = true;
            menu.id = 'easymde-immersive-font-menu-' + fieldKey;
            menu.className = 'easymde-immersive-workspace__font-select-menu';
            menu.setAttribute('role', 'listbox');
            menu.setAttribute('aria-labelledby', labelNode.id);
            menu.hidden = true;

            normalizedOptions.forEach(function (option, optionIndex) {
                var button = doc.createElement('button');
                var check = doc.createElement('span');
                var text = doc.createElement('span');
                var active = String(option.id || '') === String(selectedOption.id || '');

                button.type = 'button';
                button.className = 'easymde-immersive-workspace__font-option';
                button.setAttribute('role', 'option');
                button.setAttribute('aria-selected', active ? 'true' : 'false');
                button.setAttribute('data-appearance-value', String(option.id || ''));
                button.style.fontFamily = option.fontFamily ? String(option.fontFamily) : 'inherit';
                button.style.fontWeight = option.fontWeight !== undefined && option.fontWeight !== null
                    ? String(option.fontWeight)
                    : '';
                check.className = 'easymde-immersive-workspace__font-check';
                if (active) {
                    check.innerHTML = iconMarkup('check', 11, 2);
                }
                text.textContent = String(option.label || option.id || '');
                button.appendChild(check);
                button.appendChild(text);
                menu.appendChild(button);
                listen(button, 'click', function (event) {
                    event.stopPropagation();
                    setSelectedOption(option);
                    applyAppearanceChange(key, String(option.id || ''));
                    closeFontSelectMenu(menu, true);
                });
                listen(button, 'keydown', function (event) {
                    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                        focusMenuOption(optionIndex + (event.key === 'ArrowDown' ? 1 : -1));
                        event.preventDefault();
                    } else if (event.key === 'Home' || event.key === 'End') {
                        focusMenuOption(event.key === 'Home' ? 0 : 'last');
                        event.preventDefault();
                    } else if (event.key === 'Escape') {
                        closeFontSelectMenu(menu, true);
                        event.preventDefault();
                        event.stopPropagation();
                    }
                });
            });

            listen(trigger, 'click', function (event) {
                var willOpen = menu.hidden;
                event.stopPropagation();
                if (willOpen) {
                    openMenu();
                } else {
                    closeFontSelectMenu(menu, false);
                }
            });
            listen(trigger, 'keydown', function (event) {
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    openMenu(event.key === 'ArrowDown' ? 'selected' : 'last');
                    event.preventDefault();
                } else if (event.key === 'Escape' && !menu.hidden) {
                    closeFontSelectMenu(menu, true);
                    event.preventDefault();
                    event.stopPropagation();
                }
            });
            listen(menuBackdrop, 'click', function (event) {
                event.stopPropagation();
                closeFontSelectMenu(menu, true);
            });

            select.appendChild(trigger);
            select.appendChild(menuBackdrop);
            select.appendChild(menu);
            row.appendChild(labelNode);
            row.appendChild(select);
            container.appendChild(row);
        }

        function appearanceSwatch(kind, id) {
            if (kind === 'code') {
                return CODE_THEME_SWATCHES[id] || ['#f4f4f4', '#333333'];
            }
            if (String(id || '').indexOf('custom:') === 0) {
                return '#64748b';
            }
            return ARTICLE_THEME_SWATCHES[id] || '#333333';
        }

        function createThemeSwatch(kind, id, size) {
            var swatch = doc.createElement('span');
            var colors = appearanceSwatch(kind, id);
            swatch.className = 'easymde-immersive-workspace__theme-swatch' + (kind === 'code' ? ' is-code' : '');
            swatch.style.setProperty('--easymde-theme-swatch-size', String(size) + 'px');

            if (Array.isArray(colors)) {
                colors.forEach(function (color) {
                    var half = doc.createElement('span');
                    half.style.background = color;
                    swatch.appendChild(half);
                });
            } else {
                swatch.style.background = colors;
            }

            return swatch;
        }

        function applyAppearanceChange(key, value) {
            var changes = {};
            changes[key] = value;
            if (typeof adapter.updateAppearance === 'function') {
                adapter.updateAppearance(changes, { preview: preview, markdown: source.value });
            }
        }

        function updateThemeDot(themeId) {
            var dot = query('.easymde-immersive-workspace__theme-dot');
            if (dot) {
                dot.style.background = appearanceSwatch('article', themeId);
            }
        }

        function closeThemeSelectMenu(menu, restoreFocus) {
            var select = menu ? menu.parentNode : null;
            var backdrop = select && select.querySelector
                ? select.querySelector('.easymde-immersive-workspace__theme-select-backdrop')
                : null;
            var trigger = select && select.querySelector
                ? select.querySelector('.easymde-immersive-workspace__theme-select-trigger')
                : null;

            if (!menu) {
                return;
            }
            menu.hidden = true;
            if (backdrop) {
                backdrop.hidden = true;
            }
            if (trigger) {
                trigger.setAttribute('aria-expanded', 'false');
                if (restoreFocus && trigger.focus) {
                    trigger.focus();
                }
            }
        }

        function appendThemeSelect(container, labelText, key, kind, options, selected, rerender) {
            var field = doc.createElement('div');
            var labelNode = doc.createElement('p');
            var select = doc.createElement('div');
            var trigger = doc.createElement('button');
            var value = doc.createElement('span');
            var valueText = doc.createElement('span');
            var menuBackdrop = doc.createElement('div');
            var menu = doc.createElement('div');
            var normalizedOptions = options || [];
            var selectedOption = normalizedOptions.find(function (option) {
                return String(option.id || '') === String(selected || '');
            }) || normalizedOptions[0] || { id: '', label: '\u2014' };

            field.className = 'easymde-immersive-workspace__theme-field';
            labelNode.textContent = labelText;
            select.className = 'easymde-immersive-workspace__theme-select';
            trigger.type = 'button';
            trigger.className = 'easymde-immersive-workspace__theme-select-trigger';
            trigger.setAttribute('aria-expanded', 'false');
            trigger.setAttribute('data-appearance-key', key);
            value.className = 'easymde-immersive-workspace__theme-select-value';
            valueText.textContent = String(selectedOption.label || selectedOption.id || '\u2014');
            value.appendChild(createThemeSwatch(kind, selectedOption.id, 10));
            value.appendChild(valueText);
            trigger.appendChild(value);
            trigger.insertAdjacentHTML('beforeend', iconMarkup('chevron-down', 13, 2));
            menuBackdrop.className = 'easymde-immersive-workspace__theme-select-backdrop';
            menuBackdrop.hidden = true;
            menu.className = 'easymde-immersive-workspace__theme-select-menu';
            menu.setAttribute('role', 'listbox');
            menu.hidden = true;

            normalizedOptions.forEach(function (option) {
                var button = doc.createElement('button');
                var check = doc.createElement('span');
                var text = doc.createElement('span');
                var active = String(option.id || '') === String(selectedOption.id || '');

                button.type = 'button';
                button.className = 'easymde-immersive-workspace__theme-option';
                button.setAttribute('data-appearance-value', String(option.id || ''));
                button.setAttribute('role', 'option');
                button.setAttribute('aria-selected', active ? 'true' : 'false');
                check.className = 'easymde-immersive-workspace__theme-check';
                if (active) {
                    check.innerHTML = iconMarkup('check', 11, 2);
                }
                text.textContent = String(option.label || option.id || '');
                button.appendChild(check);
                button.appendChild(createThemeSwatch(kind, option.id, 13));
                button.appendChild(text);
                menu.appendChild(button);
                listen(button, 'click', function (event) {
                    event.stopPropagation();
                    applyAppearanceChange(key, String(option.id || ''));
                    if (key === 'markdownTheme') {
                        updateThemeDot(option.id);
                    }
                    rerender(key, String(option.id || ''));
                });
            });

            listen(trigger, 'click', function () {
                var willOpen = menu.hidden;
                container.querySelectorAll('.easymde-immersive-workspace__theme-select-menu').forEach(function (other) {
                    other.hidden = true;
                });
                container.querySelectorAll('.easymde-immersive-workspace__theme-select-backdrop').forEach(function (other) {
                    other.hidden = true;
                });
                container.querySelectorAll('.easymde-immersive-workspace__theme-select-trigger').forEach(function (other) {
                    other.setAttribute('aria-expanded', 'false');
                });
                menuBackdrop.hidden = !willOpen;
                menu.hidden = !willOpen;
                trigger.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
            });
            listen(menuBackdrop, 'click', function (event) {
                event.stopPropagation();
                closeThemeSelectMenu(menu, true);
            });

            select.appendChild(trigger);
            select.appendChild(menuBackdrop);
            select.appendChild(menu);
            field.appendChild(labelNode);
            field.appendChild(select);
            container.appendChild(field);
        }

        function renderThemeFields(container, data, state) {
            var rerender = function (key, value) {
                state[key] = value;
                renderThemeFields(container, data, state);
            };
            var macLabel;
            var macToggle;
            var customButton;

            container.textContent = '';
            appendThemeSelect(container, strings.articleTheme || 'Article theme', 'markdownTheme', 'article', data.themes, state.markdownTheme, rerender);
            appendThemeSelect(container, strings.codeTheme || 'Code theme', 'codeTheme', 'code', data.codeThemes, state.codeTheme, rerender);

            macLabel = doc.createElement('label');
            macLabel.className = 'easymde-immersive-workspace__theme-mac';
            macToggle = doc.createElement('input');
            macToggle.type = 'checkbox';
            macToggle.name = 'easymde_immersive_code_mac_style';
            macToggle.checked = state.codeMacStyle !== false;
            macToggle.setAttribute('data-appearance-key', 'codeMacStyle');
            macLabel.appendChild(macToggle);
            macLabel.appendChild(doc.createTextNode(strings.macCodeFrame || 'Mac code frame'));
            container.appendChild(macLabel);
            listen(macToggle, 'change', function () {
                state.codeMacStyle = !!macToggle.checked;
                applyAppearanceChange('codeMacStyle', state.codeMacStyle);
            });

            customButton = doc.createElement('button');
            customButton.type = 'button';
            customButton.className = 'easymde-immersive-workspace__custom-css-button';
            customButton.setAttribute('data-action', 'custom-css');
            customButton.textContent = strings.customCssTheme || 'Custom CSS theme';
            container.appendChild(customButton);
            listen(customButton, 'click', function (event) {
                event.stopPropagation();
                openCustomCssDialog(customButton);
            });
        }

        function openAppearance(kind, trigger) {
            var popover = query('[data-popover="appearance"]');
            var fields = query('[data-appearance-fields]');
            var help;
            var data = typeof adapter.getAppearanceOptions === 'function'
                ? adapter.getAppearanceOptions()
                : { state: {}, themes: [], codeThemes: [], fonts: {} };
            var state = data.state || {};

            closePopovers(false);
            fields.textContent = '';
            popover.classList.toggle('is-theme', kind === 'theme');
            popover.classList.toggle('is-font', kind === 'font');
            popover.setAttribute('data-appearance-kind', kind);
            popover.setAttribute('aria-label', kind === 'font' ? (strings.font || 'Font') : (strings.theme || 'Theme'));
            if (kind === 'font') {
                appendAppearanceSelect(fields, strings.customFont || 'Custom font', 'customFont', data.fonts.customFonts, state.customFont);
                appendAppearanceSelect(fields, strings.windowsFont || 'Windows font', 'windowsFont', data.fonts.windowsFonts, state.windowsFont);
                appendAppearanceSelect(fields, strings.appleFont || 'Apple font', 'appleFont', data.fonts.appleFonts, state.appleFont);
                appendAppearanceSelect(fields, strings.serifFont || 'Serif font', 'serifFont', data.fonts.serifOptions, state.serifFont);
                help = doc.createElement('p');
                help.className = 'easymde-immersive-workspace__font-help';
                help.textContent = strings.fontStackHelp || 'Fonts are applied in custom, Windows, Apple, and serif fallback order when supported by the current system.';
                fields.appendChild(help);
            } else {
                renderThemeFields(fields, data, state);
                updateThemeDot(state.markdownTheme);
            }
            openPopover(popover, trigger);
        }

        function customCssErrorMessage(error, fallback) {
            if (error && typeof error.message === 'string' && error.message.trim()) {
                return error.message.trim();
            }

            return fallback;
        }

        function setCustomCssStatus(message, isError) {
            var status = query('[data-custom-css-status]');

            if (!status) {
                return;
            }
            status.textContent = String(message || '');
            status.hidden = !message;
            status.classList.toggle('is-error', !!isError);
        }

        function setCustomCssSaveLabel(saved) {
            var button = query('[data-custom-css-save]');
            var labelNode = query('[data-custom-css-save-label]');

            if (!button || !labelNode) {
                return;
            }
            button.classList.toggle('is-saved', !!saved);
            button.querySelectorAll('.easymde-immersive-icon').forEach(function (icon) {
                icon.remove();
            });
            if (saved) {
                button.insertAdjacentHTML('afterbegin', iconMarkup('check', 14, 2));
            }
            labelNode.textContent = saved
                ? (strings.customCssSaved || 'Saved')
                : (strings.customCssSaveTheme || 'Save theme');
        }

        function updateCustomCssSaveButton() {
            var button = query('[data-custom-css-save]');
            var nameInput = query('[data-custom-css-name]');
            var codeInput = query('[data-custom-css-code]');

            if (!button || !nameInput || !codeInput) {
                return;
            }
            button.disabled = customCssSubmitting
                || !customCssPreviewValid
                || !nameInput.value.trim()
                || !codeInput.value.trim();
        }

        function copyCustomCssPreviewContent() {
            var surface = query('.easymde-immersive-workspace__custom-css-preview-content');
            var content = query('[data-custom-css-preview-content]');
            var classNames;
            var styleValue;

            if (!surface || !content || !preview) {
                return;
            }

            classNames = Array.prototype.filter.call(preview.classList || [], function (className) {
                return className !== 'easymde-immersive-workspace__preview'
                    && className !== 'easymde-custom-css-active'
                    && className !== 'easymde-markdown-theme-custom';
            });
            if (classNames.indexOf('easymde-rendered-content') === -1) {
                classNames.push('easymde-rendered-content');
            }
            if (
                classNames.filter(function (className) {
                    return className.indexOf('easymde-markdown-theme-') === 0;
                }).length === 0
            ) {
                classNames.push('easymde-markdown-theme-default');
            }
            classNames.unshift('easymde-immersive-workspace__custom-css-preview-content');
            surface.className = classNames.filter(function (className, index, values) {
                return values.indexOf(className) === index;
            }).join(' ');

            styleValue = preview.getAttribute ? String(preview.getAttribute('style') || '') : '';
            if (styleValue) {
                surface.setAttribute('style', styleValue);
            } else {
                surface.removeAttribute('style');
            }

            content.textContent = '';
            Array.prototype.forEach.call(preview.childNodes || [], function (node) {
                content.appendChild(node.cloneNode(true));
            });
        }

        function clearCustomCssTimers() {
            if (customCssPreviewTimer !== null) {
                win.clearTimeout(customCssPreviewTimer);
                customCssPreviewTimer = null;
            }
            if (customCssSavedTimer !== null) {
                win.clearTimeout(customCssSavedTimer);
                customCssSavedTimer = null;
            }
        }

        function scheduleCustomCssPreview(css, immediate) {
            var sequence = customCssPreviewSequence + 1;
            var runPreview;

            customCssPreviewSequence = sequence;
            customCssPreviewValid = false;
            if (customCssPreviewTimer !== null) {
                win.clearTimeout(customCssPreviewTimer);
                customCssPreviewTimer = null;
            }
            setCustomCssStatus(strings.customCssValidating || 'Checking CSS...', false);
            updateCustomCssSaveButton();

            runPreview = function () {
                var previewStyle = query('[data-custom-css-preview-style]');

                customCssPreviewTimer = null;
                if (!root || sequence !== customCssPreviewSequence || !customCssState) {
                    return;
                }
                if (typeof adapter.previewCustomCss !== 'function') {
                    setCustomCssStatus(strings.customCssPreviewFailed || 'CSS preview failed.', true);
                    updateCustomCssSaveButton();
                    return;
                }

                Promise.resolve(adapter.previewCustomCss(css)).then(function (response) {
                    if (!root || sequence !== customCssPreviewSequence || !customCssState) {
                        return;
                    }
                    previewStyle.textContent = String(response.scopedCss || '');
                    customCssPreviewValid = true;
                    setCustomCssStatus('', false);
                    updateCustomCssSaveButton();
                }).catch(function (error) {
                    if (!root || sequence !== customCssPreviewSequence || !customCssState) {
                        return;
                    }
                    previewStyle.textContent = '';
                    customCssPreviewValid = false;
                    setCustomCssStatus(
                        customCssErrorMessage(error, strings.customCssPreviewFailed || 'CSS preview failed.'),
                        true
                    );
                    updateCustomCssSaveButton();
                });
            };

            if (immediate) {
                runPreview();
            } else {
                customCssPreviewTimer = win.setTimeout(runPreview, 240);
            }
        }

        function openCustomCssDialog(trigger) {
            var existing = typeof adapter.getCustomCssState === 'function'
                ? adapter.getCustomCssState()
                : null;
            var nameInput = query('[data-custom-css-name]');
            var codeInput = query('[data-custom-css-code]');
            var dialog = query('.easymde-immersive-workspace__custom-css-modal');
            var closeButton = dialog.querySelector('[data-action="close-custom-css"]');

            clearCustomCssTimers();
            customCssState = {
                id: existing && existing.id ? String(existing.id) : '',
                name: existing && existing.name
                    ? String(existing.name)
                    : (strings.customCssDefaultName || 'My theme'),
                css: existing && existing.css ? String(existing.css) : DEFAULT_CUSTOM_CSS
            };
            customCssReturnFocus = trigger || null;
            customCssSubmitting = false;
            customCssPreviewValid = false;
            nameInput.value = customCssState.name;
            codeInput.value = customCssState.css;
            setCustomCssSaveLabel(false);
            setCustomCssStatus('', false);
            copyCustomCssPreviewContent();
            dialog.hidden = false;
            query('[data-custom-css-backdrop]').hidden = false;
            scheduleCustomCssPreview(codeInput.value, true);
            try {
                closeButton.focus({ preventScroll: true });
            } catch (error) {
                closeButton.focus();
            }
        }

        function closeCustomCssDialog() {
            var dialog = query('.easymde-immersive-workspace__custom-css-modal');
            var previewStyle = query('[data-custom-css-preview-style]');
            var returnFocus = customCssReturnFocus;

            clearCustomCssTimers();
            customCssPreviewSequence += 1;
            customCssSubmitting = false;
            customCssPreviewValid = false;
            customCssState = null;
            customCssReturnFocus = null;
            if (dialog) {
                dialog.hidden = true;
            }
            query('[data-custom-css-backdrop]').hidden = true;
            if (previewStyle) {
                previewStyle.textContent = '';
            }
            setCustomCssStatus('', false);
            if (returnFocus && returnFocus.isConnected && returnFocus.focus) {
                returnFocus.focus();
            }
        }

        function saveCustomCss() {
            var button = query('[data-custom-css-save]');
            var input;
            var activeState = customCssState;

            if (!activeState || !button || button.disabled || typeof adapter.saveCustomCss !== 'function') {
                return;
            }
            input = {
                id: activeState.id,
                name: query('[data-custom-css-name]').value.trim(),
                css: query('[data-custom-css-code]').value
            };
            customCssSubmitting = true;
            setCustomCssStatus('', false);
            updateCustomCssSaveButton();

            Promise.resolve(adapter.saveCustomCss(input, { preview: preview, markdown: source.value })).then(function (item) {
                if (!root || customCssState !== activeState) {
                    return;
                }
                customCssState.id = item && item.id ? String(item.id) : customCssState.id;
                customCssSubmitting = true;
                customCssPreviewValid = true;
                updateThemeDot('custom:' + customCssState.id);
                setCustomCssSaveLabel(true);
                updateCustomCssSaveButton();
                customCssSavedTimer = win.setTimeout(closeCustomCssDialog, 800);
            }).catch(function (error) {
                if (!root || customCssState !== activeState) {
                    return;
                }
                customCssSubmitting = false;
                setCustomCssStatus(
                    customCssErrorMessage(error, strings.cssSaveFailed || 'CSS save failed.'),
                    true
                );
                updateCustomCssSaveButton();
            });
        }

        function renderPublishTags() {
            var hiddenInput = query('[data-publish-tags]');
            var input = query('[data-publish-tag-input]');
            var list = query('[data-publish-tag-list]');

            if (!publishDraft || !hiddenInput || !input || !list) {
                return;
            }

            hiddenInput.value = publishDraft.tags.join(', ');
            input.placeholder = publishDraft.tags.length
                ? (strings.publishTagContinuePlaceholder || 'Continue adding...')
                : (strings.publishTagPlaceholder || 'Add tags');
            list.textContent = '';
            publishDraft.tags.forEach(function (tag, index) {
                var chip = doc.createElement('span');
                var text = doc.createElement('span');
                var remove = doc.createElement('button');

                chip.className = 'easymde-immersive-workspace__publish-tag';
                text.textContent = tag;
                remove.type = 'button';
                remove.setAttribute('data-publish-remove-tag', String(index));
                remove.setAttribute('aria-label', (strings.removeTag || 'Remove tag') + ' ' + tag);
                remove.innerHTML = iconMarkup('x', 10, 2.4);
                chip.appendChild(text);
                chip.appendChild(remove);
                list.appendChild(chip);
            });
        }

        function commitPublishTagInput() {
            var input = query('[data-publish-tag-input]');
            var incoming;

            if (!publishDraft || !input || !input.value.trim()) {
                return;
            }

            incoming = input.value.split(/[,，\n]+/);
            publishDraft.tags = uniqueStrings(publishDraft.tags.concat(incoming), true);
            input.value = '';
            renderPublishTags();
        }

        function updatePublishCounts() {
            var excerpt = query('[data-publish-excerpt]');
            var excerptCount = query('[data-publish-excerpt-count]');
            var categoryCount = query('[data-publish-category-count]');
            var selectedCategories = root.querySelectorAll('[data-publish-category]:checked').length;

            if (excerpt && excerptCount) {
                excerptCount.textContent = Array.from(excerpt.value).length + ' / 160';
            }
            if (categoryCount) {
                categoryCount.textContent = (strings.publishCategoryCount || 'Selected %d').replace('%d', String(selectedCategories));
            }
        }

        function setPublishPasswordError(message) {
            var input = query('[data-publish-password]');
            var error = query('[data-publish-password-error]');

            error.textContent = message || '';
            error.hidden = !message;
            if (message) {
                input.setAttribute('aria-invalid', 'true');
                input.setAttribute('aria-describedby', 'easymde-immersive-publish-password-error');
            } else {
                input.removeAttribute('aria-invalid');
                input.removeAttribute('aria-describedby');
            }
        }

        function renderPublishVisibility() {
            var stickyRow = query('[data-publish-sticky-row]');
            var sticky = query('[data-publish-sticky]');
            var passwordRow = query('[data-publish-password-row]');
            var password = query('[data-publish-password]');
            var privateHelp = query('[data-publish-private-help]');

            root.querySelectorAll('[data-publish-visibility]').forEach(function (input) {
                var active = input.value === publishDraft.visibility;
                input.checked = active;
                input.closest('label').classList.toggle('is-active', active);
            });
            stickyRow.hidden = publishDraft.visibility !== 'public';
            sticky.checked = publishDraft.visibility === 'public' && publishDraft.sticky;
            passwordRow.hidden = publishDraft.visibility !== 'password';
            password.value = publishDraft.visibility === 'password' ? publishDraft.password : '';
            privateHelp.hidden = publishDraft.visibility !== 'private';
        }

        function updatePublishButton(mode) {
            var publishButton = query('[data-action="publish"]');
            var publishLabel = query('[data-publish-label]');
            var buttonLabel = mode === 'update'
                ? (strings.updateArticle || 'Update article')
                : (strings.publishArticle || 'Publish article');
            var shortcutLabel = mode === 'update'
                ? (strings.updateArticleShortcut || 'Update article (⌘↵)')
                : (strings.publishArticleShortcut || 'Publish article (⌘↵)');

            publishLabel.textContent = buttonLabel;
            publishButton.setAttribute('aria-label', buttonLabel);
            publishButton.setAttribute('title', shortcutLabel);
        }

        function renderPublishPreviewState() {
            var previewInput = query('[data-publish-preview]');
            var previewThumb = query('[data-publish-preview-thumb]');

            previewInput.checked = publishDraft.openPreview;
            previewThumb.innerHTML = publishDraft.openPreview
                ? iconMarkup('check', 11, 3.4)
                : '';
        }

        function renderPublishCategories() {
            var categoriesNode = query('[data-publish-categories]');
            var tree = createPublishCategoryTree(publishState && publishState.categoryOptions);
            var selected = Object.create(null);

            if (!categoriesNode || !publishDraft) {
                return;
            }
            publishDraft.categories.forEach(function (id) {
                selected[String(id)] = true;
            });
            categoriesNode.textContent = '';

            function hasSelectedDescendant(node) {
                return node.children.some(function (child) {
                    return !!selected[child.id] || hasSelectedDescendant(child);
                });
            }

            function createToggle(node, isRoot) {
                var toggle = doc.createElement('button');
                var collapsed = !!publishCategoryCollapsed[node.id];

                toggle.type = 'button';
                toggle.className = 'easymde-immersive-workspace__category-toggle' + (isRoot ? ' is-root' : '');
                toggle.setAttribute('data-publish-category-toggle', node.id);
                toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
                toggle.setAttribute('aria-label', collapsed
                    ? (strings.expand || 'Expand') + ' ' + node.label
                    : (strings.collapse || 'Collapse') + ' ' + node.label);
                toggle.innerHTML = '<svg width="7" height="7" viewBox="0 0 7 7" fill="none" aria-hidden="true"><path d="M0.5 3.5H6.5" stroke="currentColor" stroke-width="1" stroke-linecap="round"></path>'
                    + (collapsed ? '<path d="M3.5 0.5V6.5" stroke="currentColor" stroke-width="1" stroke-linecap="round"></path>' : '')
                    + '</svg>';
                return toggle;
            }

            function renderNode(node, depth, isLast, ancestorsLast) {
                var wrapper = doc.createElement('div');
                var row = doc.createElement('div');
                var labelNode = doc.createElement('label');
                var input = doc.createElement('input');
                var visual = doc.createElement('span');
                var text = doc.createElement('span');
                var checked = !!selected[node.id];
                var indeterminate = !checked && hasSelectedDescendant(node);
                var collapsed = !!publishCategoryCollapsed[node.id];

                wrapper.className = 'easymde-immersive-workspace__category-node';
                row.className = 'easymde-immersive-workspace__category-row';
                ancestorsLast.forEach(function (ancestorLast) {
                    var ancestor = doc.createElement('span');
                    ancestor.className = 'easymde-immersive-workspace__category-ancestor' + (ancestorLast ? '' : ' is-continuing');
                    ancestor.setAttribute('aria-hidden', 'true');
                    row.appendChild(ancestor);
                });
                if (depth > 0) {
                    var connector = doc.createElement('span');
                    connector.className = 'easymde-immersive-workspace__category-connector' + (isLast ? ' is-last' : '');
                    connector.setAttribute('aria-hidden', 'true');
                    if (node.children.length) {
                        connector.appendChild(createToggle(node, false));
                    }
                    row.appendChild(connector);
                } else if (node.children.length) {
                    row.appendChild(createToggle(node, true));
                } else {
                    var spacer = doc.createElement('span');
                    spacer.className = 'easymde-immersive-workspace__category-root-spacer';
                    spacer.setAttribute('aria-hidden', 'true');
                    row.appendChild(spacer);
                }

                input.type = 'checkbox';
                input.id = 'easymde-immersive-publish-category-' + node.id;
                input.name = 'easymde_immersive_publish_categories[]';
                input.value = node.id;
                input.checked = checked;
                input.indeterminate = indeterminate;
                input.setAttribute('data-publish-category', '1');
                input.setAttribute('aria-label', node.label);
                visual.className = 'easymde-immersive-workspace__category-checkbox';
                visual.setAttribute('aria-hidden', 'true');
                visual.innerHTML = indeterminate
                    ? iconMarkup('minus', 11, 3.2)
                    : (checked ? iconMarkup('check', 11, 3.2) : '');
                text.className = 'easymde-immersive-workspace__category-label';
                text.textContent = node.label;
                labelNode.appendChild(input);
                labelNode.appendChild(visual);
                labelNode.appendChild(text);
                row.appendChild(labelNode);
                wrapper.appendChild(row);

                if (node.children.length && !collapsed) {
                    var children = doc.createElement('div');
                    children.className = 'easymde-immersive-workspace__category-children';
                    node.children.forEach(function (child, index) {
                        children.appendChild(renderNode(
                            child,
                            depth + 1,
                            index === node.children.length - 1,
                            ancestorsLast.concat([isLast])
                        ));
                    });
                    wrapper.appendChild(children);
                }
                return wrapper;
            }

            tree.forEach(function (node, index) {
                categoriesNode.appendChild(renderNode(node, 0, index === tree.length - 1, []));
            });
            if (!tree.length) {
                categoriesNode.textContent = strings.noCategories || 'No categories are available for this post type.';
            }
        }

        function renderPublishDialog(shouldFocus) {
            var dialog = query('.easymde-immersive-workspace__publish');
            var titleNode = query('#easymde-immersive-publish-title');
            var summaryNode = query('[data-publish-summary]');
            var statusNode = query('[data-publish-status]');
            var featuredSummary = query('[data-featured-summary]');
            var featuredEmpty = query('[data-featured-empty]');
            var featuredSelected = query('[data-featured-selected]');
            var featuredImage = query('[data-featured-image]');
            var previewLabel = query('[data-publish-preview-label]');
            var previewInput = query('[data-publish-preview]');
            var confirm = query('[data-publish-confirm]');
            var confirmLabel = query('[data-publish-confirm-label]');

            if (!publishDraft || !publishState) {
                return;
            }
            titleNode.textContent = publishDraft.mode === 'update'
                ? (strings.updateArticle || 'Update article')
                : (strings.publishArticle || 'Publish article');
            summaryNode.textContent = publishDraft.mode === 'update'
                ? (strings.updateArticleHelp || 'Confirm these settings to update the current WordPress article.')
                : (strings.publishArticleHelp || 'Confirm these settings to publish to the current WordPress site.');
            statusNode.textContent = publishDraft.mode === 'update'
                ? (strings.updateExistingArticle || 'Update existing article')
                : (strings.readyToPublish || 'Ready to publish');
            confirmLabel.textContent = titleNode.textContent;
            query('[data-publish-excerpt]').value = publishDraft.excerpt;
            renderPublishPreviewState();
            previewLabel.textContent = publishDraft.mode === 'update'
                ? (strings.openPreviewAfterUpdate || 'Open preview after updating')
                : (strings.publishPreviewAfter || 'Open preview after publishing');
            previewInput.setAttribute('aria-label', previewLabel.textContent);
            featuredSummary.textContent = publishDraft.featuredImage
                ? (publishDraft.featuredImage.alt || publishDraft.featuredImage.url || String(publishDraft.featuredImage.id))
                : (strings.noFeaturedImage || 'No featured image selected');
            featuredEmpty.hidden = !!publishDraft.featuredImage;
            featuredSelected.hidden = !publishDraft.featuredImage;
            if (publishDraft.featuredImage) {
                featuredImage.src = publishDraft.featuredImage.url;
                featuredImage.alt = publishDraft.featuredImage.alt || '';
            } else {
                featuredImage.removeAttribute('src');
                featuredImage.alt = '';
            }
            setPublishPasswordError('');
            renderPublishVisibility();
            renderPublishTags();
            renderPublishCategories();
            updatePublishCounts();
            renderPublishSubmittingState();
            dialog.hidden = false;
            query('[data-publish-backdrop]').hidden = false;
            if (shouldFocus !== false) {
                confirm.focus();
            }
        }

        function openPublishDialog() {
            var sequence = publishSequence + 1;
            closePopovers(false);
            publishState = typeof adapter.getPublishState === 'function' ? adapter.getPublishState() : {};
            publishDraft = createPublishDraft(publishState);
            publishSequence = sequence;
            publishSubmitting = false;
            featuredImageTouched = false;
            renderPublishDialog(true);

            if (!publishDraft.featuredImage && typeof adapter.getFeaturedImageCandidate === 'function') {
                Promise.resolve(adapter.getFeaturedImageCandidate(source ? source.value : '')).then(function (image) {
                    if (
                        !root
                        || sequence !== publishSequence
                        || !publishDraft
                        || featuredImageTouched
                        || !image
                        || Number(image.id) <= 0
                    ) {
                        return;
                    }
                    publishDraft.featuredImage = image;
                    renderPublishDialog(false);
                }).catch(function () {
                    var summary = query('[data-featured-summary]');
                    if (root && sequence === publishSequence && summary && !featuredImageTouched) {
                        summary.textContent = strings.featuredImageLookupFailed || 'The first local image could not be verified.';
                    }
                });
            }
        }

        function renderPublishSubmittingState() {
            var dialog = query('.easymde-immersive-workspace__publish');
            var progress = query('[data-publish-progress]');

            if (!dialog || !progress) {
                return;
            }
            dialog.setAttribute('aria-busy', publishSubmitting ? 'true' : 'false');
            dialog.querySelectorAll('button, input, textarea').forEach(function (control) {
                control.disabled = publishSubmitting;
            });
            progress.innerHTML = publishSubmitting
                ? '<span><span class="easymde-immersive-workspace__publish-progress-spinner" aria-hidden="true"></span>'
                    + escapeHtml(strings.publishLoadingPreview || 'Loading preview...') + '</span>'
                : '';
        }

        function closePublishDialog(force) {
            var dialog = query('.easymde-immersive-workspace__publish');
            if (publishSubmitting && !force) {
                return false;
            }
            if (dialog) {
                dialog.hidden = true;
            }
            query('[data-publish-backdrop]').hidden = true;
            publishSubmitting = false;
            publishDraft = null;
            publishState = null;
            publishSequence += 1;
            featuredImageTouched = false;
            query('[data-action="publish"]').focus();
            return true;
        }

        function formatHistoryDate(value) {
            var date = new Date(value);
            var pad = function (number) { return String(number).padStart(2, '0'); };

            if (isNaN(date.getTime())) {
                return String(value || '');
            }

            return date.getFullYear()
                + '-' + pad(date.getMonth() + 1)
                + '-' + pad(date.getDate())
                + ' ' + pad(date.getHours())
                + ':' + pad(date.getMinutes());
        }

        function formatHistoryRelative(value) {
            var date = new Date(value);
            var delta;
            var absolute;
            var locale;
            var formatter;
            var amount;
            var unit;

            if (isNaN(date.getTime())) {
                return '';
            }

            delta = date.getTime() - Date.now();
            absolute = Math.abs(delta);
            if (absolute < 60000) {
                return strings.historyJustNow || 'Just now';
            }

            if (absolute < 3600000) {
                amount = Math.round(delta / 60000);
                unit = 'minute';
            } else if (absolute < 86400000) {
                amount = Math.round(delta / 3600000);
                unit = 'hour';
            } else if (absolute < 604800000) {
                amount = Math.round(delta / 86400000);
                unit = 'day';
            } else {
                return formatHistoryDate(value).slice(0, 10);
            }

            locale = doc.documentElement && doc.documentElement.lang ? doc.documentElement.lang : undefined;
            try {
                formatter = new win.Intl.RelativeTimeFormat(locale, { numeric: 'always', style: 'short' });
                return formatter.format(amount, unit);
            } catch (error) {
                return formatHistoryDate(value).slice(0, 10);
            }
        }

        function historyTypeLabel(type) {
            return type === 'auto'
                ? (strings.historyAutoSave || 'Auto save')
                : (strings.historyManualSave || 'Manual save');
        }

        function closeHistoryFilter(restoreFocus) {
            var menu = query('.easymde-immersive-workspace__history-filter-menu');
            var trigger = query('[data-action="history-filter"]');

            if (!menu || menu.hidden) {
                return;
            }
            menu.hidden = true;
            trigger.setAttribute('aria-expanded', 'false');
            if (restoreFocus) {
                trigger.focus();
            }
        }

        function updateHistoryFilterControls() {
            var labels = {
                all: strings.historyFilterAll || 'All',
                auto: strings.historyAutoSave || 'Auto save',
                manual: strings.historyManualSave || 'Manual save'
            };
            var labelNode = query('[data-history-filter-label]');

            labelNode.textContent = labels[historyFilter];
            root.querySelectorAll('[data-history-filter]').forEach(function (button) {
                var active = button.getAttribute('data-history-filter') === historyFilter;
                button.classList.toggle('is-active', active);
                button.setAttribute('aria-checked', active ? 'true' : 'false');
            });
        }

        function historyEntryById(id) {
            return historyEntries.find(function (entry) {
                return Number(entry.id) === Number(id);
            }) || null;
        }

        function setHistoryPreviewStatus(message, isError) {
            var previewNode = query('[data-history-preview]');

            previewNode.className = 'easymde-immersive-workspace__history-preview is-status' + (isError ? ' is-error' : '');
            previewNode.textContent = message;
        }

        function selectHistoryEntry(id) {
            var entry = historyEntryById(id);
            var selectedLabel = query('[data-history-selected-label]');
            var selectedDate = query('[data-history-selected-date]');
            var restoreButton = query('[data-action="restore-history"]');
            var previewNode = query('[data-history-preview]');
            var sequence;

            if (!entry) {
                return;
            }

            historySelectedId = Number(entry.id);
            selectedLabel.textContent = historyTypeLabel(entry.type);
            selectedDate.textContent = formatHistoryDate(entry.date);
            restoreButton.disabled = true;
            root.querySelectorAll('.easymde-immersive-workspace__history-entry').forEach(function (button) {
                var active = Number(button.getAttribute('data-revision-id')) === historySelectedId;
                button.classList.toggle('is-active', active);
                button.setAttribute('aria-selected', active ? 'true' : 'false');
            });

            historyDetailSequence += 1;
            sequence = historyDetailSequence;
            setHistoryPreviewStatus(strings.loadingHistoryPreview || 'Loading revision preview...', false);

            if (typeof adapter.getRevision !== 'function' || typeof adapter.renderRevisionPreview !== 'function') {
                setHistoryPreviewStatus(strings.historyPreviewFailed || 'Revision preview could not be loaded.', true);
                return;
            }

            Promise.resolve(adapter.getRevision(entry.id)).then(function (revision) {
                if (!root || sequence !== historyDetailSequence || historySelectedId !== Number(entry.id)) {
                    return;
                }
                return Promise.resolve(adapter.renderRevisionPreview(previewNode, revision || {})).then(function () {
                    if (!root || sequence !== historyDetailSequence || historySelectedId !== Number(entry.id)) {
                        return;
                    }
                    restoreButton.disabled = false;
                });
            }).catch(function () {
                if (!root || sequence !== historyDetailSequence || historySelectedId !== Number(entry.id)) {
                    return;
                }
                setHistoryPreviewStatus(strings.historyPreviewFailed || 'Revision preview could not be loaded.', true);
            });
        }

        function renderHistoryList() {
            var list = query('[data-history-list]');
            var count = query('[data-history-count]');
            var filtered = historyEntries.filter(function (entry) {
                return historyFilter === 'all' || entry.type === historyFilter;
            });

            list.textContent = '';
            count.textContent = (strings.historyCount || '%d revisions').replace('%d', String(filtered.length));
            updateHistoryFilterControls();

            if (!filtered.length) {
                list.classList.add('is-empty');
                list.textContent = strings.noRevisions || 'No revisions are available yet.';
                query('[data-action="restore-history"]').disabled = true;
                setHistoryPreviewStatus(strings.noRevisions || 'No revisions are available yet.', false);
                return;
            }

            list.classList.remove('is-empty');
            if (filtered.some(function (entry) { return entry.type === 'auto'; })) {
                var group = doc.createElement('div');
                var groupLabel = doc.createElement('span');
                group.className = 'easymde-immersive-workspace__history-group';
                group.innerHTML = iconMarkup('clock', 11, 2);
                groupLabel.textContent = strings.historyAutoSave || 'Auto save';
                group.appendChild(groupLabel);
                list.appendChild(group);
            }

            filtered.forEach(function (entry) {
                var button = doc.createElement('button');
                var firstLine = doc.createElement('span');
                var typeLabel = doc.createElement('strong');
                var relative = doc.createElement('small');
                var date = doc.createElement('span');

                button.type = 'button';
                button.className = 'easymde-immersive-workspace__history-entry';
                button.setAttribute('data-revision-id', String(entry.id));
                button.setAttribute('data-revision-type', entry.type);
                button.setAttribute('role', 'option');
                firstLine.className = 'easymde-immersive-workspace__history-entry-main';
                firstLine.innerHTML = iconMarkup(entry.type === 'auto' ? 'clock' : 'save', 11, entry.type === 'auto' ? 2 : 2.5);
                typeLabel.textContent = historyTypeLabel(entry.type);
                relative.textContent = formatHistoryRelative(entry.date);
                date.className = 'easymde-immersive-workspace__history-entry-date';
                date.textContent = formatHistoryDate(entry.date);
                firstLine.appendChild(typeLabel);
                firstLine.appendChild(relative);
                button.appendChild(firstLine);
                button.appendChild(date);
                listen(button, 'click', function () {
                    selectHistoryEntry(entry.id);
                });
                list.appendChild(button);
            });

            if (!historyEntryById(historySelectedId) || !filtered.some(function (entry) { return Number(entry.id) === historySelectedId; })) {
                historySelectedId = Number(filtered[0].id);
            }
            selectHistoryEntry(historySelectedId);
        }

        function closeHistory() {
            var history = query('.easymde-immersive-workspace__history');
            if (history) {
                history.hidden = true;
            }
            query('[data-history-backdrop]').hidden = true;
            closeHistoryFilter(false);
            historySequence += 1;
            historyDetailSequence += 1;
            historyEntries = [];
            historySelectedId = 0;
            if (historyReturnFocus && historyReturnFocus.isConnected && historyReturnFocus.focus) {
                historyReturnFocus.focus();
            }
            historyReturnFocus = null;
        }

        function setTableSelection(rows, columns) {
            var dimensions = normalizeTableDimensions(rows, columns);
            var summary = query('[data-table-selection]');

            query('[data-table-rows]').value = String(dimensions.rows);
            query('[data-table-columns]').value = String(dimensions.columns);
            summary.textContent = String(dimensions.rows) + ' × ' + String(dimensions.columns);
            root.querySelectorAll('[data-table-size]').forEach(function (button) {
                var buttonRows = Number(button.getAttribute('data-table-row'));
                var buttonColumns = Number(button.getAttribute('data-table-column'));
                button.classList.toggle('is-selected', buttonRows <= dimensions.rows && buttonColumns <= dimensions.columns);
            });
            query('[data-table-error]').hidden = true;
            return dimensions;
        }

        function closeTableDialog(restoreFocus) {
            var dialog = query('.easymde-immersive-workspace__table-modal');

            if (dialog) {
                dialog.hidden = true;
            }
            query('[data-table-backdrop]').hidden = true;
            query('[data-table-error]').hidden = true;
            if (restoreFocus !== false && tableReturnFocus && tableReturnFocus.isConnected && tableReturnFocus.focus) {
                tableReturnFocus.focus();
            }
            tableReturnFocus = null;
        }

        function insertSelectedTable(rows, columns) {
            var dimensions;
            var errorNode = query('[data-table-error]');

            try {
                dimensions = normalizeTableDimensions(rows, columns);
            } catch (error) {
                errorNode.textContent = error.message;
                errorNode.hidden = false;
                return false;
            }
            if (typeof adapter.insertTable !== 'function') {
                throw new Error('The immersive table insertion adapter is unavailable.');
            }
            adapter.insertTable(dimensions.rows, dimensions.columns, source);
            closeTableDialog(false);
            source.focus();
            tableReturnFocus = null;
            return true;
        }

        function openTableDialog(trigger) {
            var dialog = query('.easymde-immersive-workspace__table-modal');
            var grid = query('[data-table-grid]');
            var row;
            var column;

            closePopovers(false);
            tableReturnFocus = trigger || query('[data-command="table"]');
            if (!grid.childNodes.length) {
                for (row = 1; row <= 10; row += 1) {
                    for (column = 1; column <= 10; column += 1) {
                        (function (buttonRow, buttonColumn) {
                            var button = doc.createElement('button');
                            button.type = 'button';
                            button.setAttribute('role', 'gridcell');
                            button.setAttribute('data-table-size', String(buttonRow) + 'x' + String(buttonColumn));
                            button.setAttribute('data-table-row', String(buttonRow));
                            button.setAttribute('data-table-column', String(buttonColumn));
                            button.setAttribute('aria-label', String(buttonRow) + ' × ' + String(buttonColumn));
                            listen(button, 'pointerenter', function () {
                                setTableSelection(buttonRow, buttonColumn);
                            });
                            listen(button, 'focus', function () {
                                setTableSelection(buttonRow, buttonColumn);
                            });
                            listen(button, 'click', function () {
                                insertSelectedTable(buttonRow, buttonColumn);
                            });
                            grid.appendChild(button);
                        }(row, column));
                    }
                }
            }
            setTableSelection(3, 3);
            dialog.hidden = false;
            query('[data-table-backdrop]').hidden = false;
            query('[data-table-rows]').focus();
        }

        function clearWechatFeedbackTimer() {
            if (wechatFeedbackTimer !== null) {
                win.clearTimeout(wechatFeedbackTimer);
                wechatFeedbackTimer = null;
            }
        }

        function renderWechatState(state, message) {
            var button = query('[data-action="wechat"]');
            var labelNode = query('[data-wechat-label]');
            var statusNode = query('[data-wechat-status]');

            if (!button) {
                return;
            }
            button.classList.remove('is-copying', 'is-success', 'is-error');
            if (state !== 'idle') {
                button.classList.add('is-' + state);
            }
            button.disabled = state === 'copying';
            labelNode.textContent = state === 'copying'
                ? (strings.copying || 'Copying...')
                : state === 'success'
                    ? (strings.copied || 'Copied')
                    : (strings.copyWechat || 'Copy to WeChat');
            statusNode.textContent = message || '';
        }

        function runWechatCopy(trigger) {
            var result;

            if (wechatCopying) {
                return Promise.resolve(false);
            }
            if (typeof adapter.performAction !== 'function') {
                return Promise.reject(new Error('The WeChat copy adapter is unavailable.'));
            }
            clearWechatFeedbackTimer();
            wechatCopying = true;
            renderWechatState('copying', strings.copying || 'Copying preview for WeChat.');
            try {
                result = adapter.performAction('wechat', { root: root, source: source, preview: preview, title: title });
            } catch (error) {
                wechatCopying = false;
                renderWechatState('error', error.message || strings.copyWechatFailed || 'Copy failed.');
                return Promise.reject(error);
            }
            return Promise.resolve(result).then(function (value) {
                wechatCopying = false;
                renderWechatState('success', strings.copyWechatSuccess || 'Copied preview for WeChat.');
                wechatFeedbackTimer = win.setTimeout(function () {
                    wechatFeedbackTimer = null;
                    if (root) {
                        renderWechatState('idle', '');
                    }
                }, 1800);
                return value;
            }).catch(function (error) {
                wechatCopying = false;
                renderWechatState('error', error && error.message ? error.message : (strings.copyWechatFailed || 'Copy failed.'));
                wechatFeedbackTimer = win.setTimeout(function () {
                    wechatFeedbackTimer = null;
                    if (root) {
                        renderWechatState('idle', '');
                    }
                }, 1800);
                throw error;
            });
        }

        function closeActiveModal() {
            var publishDialog = query('.easymde-immersive-workspace__publish');
            var historyDialog = query('.easymde-immersive-workspace__history');
            var customCssDialog = query('.easymde-immersive-workspace__custom-css-modal');
            var tableDialog = query('.easymde-immersive-workspace__table-modal');

            if (tableDialog && !tableDialog.hidden) {
                closeTableDialog();
            } else if (customCssDialog && !customCssDialog.hidden) {
                closeCustomCssDialog();
            } else if (historyDialog && !historyDialog.hidden) {
                closeHistory();
            } else if (publishDialog && !publishDialog.hidden) {
                closePublishDialog();
            }
        }

        function focusScope() {
            var publishDialog = query('.easymde-immersive-workspace__publish');
            var historyDialog = query('.easymde-immersive-workspace__history');
            var customCssDialog = query('.easymde-immersive-workspace__custom-css-modal');
            var tableDialog = query('.easymde-immersive-workspace__table-modal');

            if (tableDialog && !tableDialog.hidden) {
                return tableDialog;
            }
            if (customCssDialog && !customCssDialog.hidden) {
                return customCssDialog;
            }
            if (publishDialog && !publishDialog.hidden) {
                return publishDialog;
            }
            if (historyDialog && !historyDialog.hidden) {
                return historyDialog;
            }
            return root;
        }

        function openHistory(trigger) {
            var history = query('.easymde-immersive-workspace__history');
            var list = query('[data-history-list]');
            var request = typeof adapter.getRevisions === 'function'
                ? adapter.getRevisions()
                : Promise.resolve([]);
            var sequence;

            closePopovers(false);
            historySequence += 1;
            sequence = historySequence;
            historyDetailSequence += 1;
            historyEntries = [];
            historyFilter = 'all';
            historySelectedId = 0;
            historyReturnFocus = trigger || query('[data-action="history"]');
            updateHistoryFilterControls();
            query('[data-history-count]').textContent = (strings.historyCount || '%d revisions').replace('%d', '0');
            query('[data-history-selected-label]').textContent = strings.historyVersions || 'Version history';
            query('[data-history-selected-date]').textContent = '';
            query('[data-action="restore-history"]').disabled = true;
            list.textContent = strings.loadingHistory || 'Loading revisions...';
            list.classList.add('is-empty');
            setHistoryPreviewStatus(strings.loadingHistory || 'Loading revisions...', false);
            query('[data-history-backdrop]').hidden = false;
            history.hidden = false;
            query('[data-action="close-history"]').focus();
            Promise.resolve(request).then(function (revisions) {
                if (!root || sequence !== historySequence) {
                    return;
                }
                historyEntries = (revisions || []).map(function (revision) {
                    return {
                        id: Number(revision.id),
                        title: String(revision.title || ''),
                        date: String(revision.date || ''),
                        type: revision.type === 'auto' ? 'auto' : 'manual'
                    };
                }).filter(function (revision) {
                    return revision.id > 0;
                });
                renderHistoryList();
            }).catch(function () {
                if (!root || sequence !== historySequence) {
                    return;
                }
                list.classList.add('is-empty');
                list.textContent = strings.historyFailed || 'Revision history could not be loaded.';
                setHistoryPreviewStatus(strings.historyFailed || 'Revision history could not be loaded.', true);
            });
        }

        function updatePublishDraftFromFields() {
            var pendingTagInput;

            if (!publishDraft) {
                return;
            }
            pendingTagInput = query('[data-publish-tag-input]');
            if (pendingTagInput && pendingTagInput.value.trim()) {
                publishDraft.tags = uniqueStrings(
                    publishDraft.tags.concat(pendingTagInput.value.split(/[,，\n]+/)),
                    true
                );
                pendingTagInput.value = '';
                renderPublishTags();
            }
            publishDraft.tags = uniqueStrings(query('[data-publish-tags]').value, true);
            publishDraft.excerpt = query('[data-publish-excerpt]').value;
            publishDraft.openPreview = query('[data-publish-preview]').checked;
            publishDraft.password = publishDraft.visibility === 'password'
                ? query('[data-publish-password]').value
                : '';
            publishDraft.sticky = publishDraft.visibility === 'public'
                && query('[data-publish-sticky]').checked;
            publishDraft.categories = Array.prototype.map.call(
                root.querySelectorAll('[data-publish-category]:checked'),
                function (input) { return input.value; }
            );
        }

        function renderAiMessages() {
            var messages = query('[data-ai-messages]');

            messages.textContent = '';
            messages.hidden = !aiMessages.length;
            aiMessages.forEach(function (message) {
                var row = doc.createElement('div');
                var bubble = doc.createElement('div');
                row.className = 'easymde-immersive-workspace__ai-message is-' + message.role;
                bubble.className = 'easymde-immersive-workspace__ai-message-bubble';
                bubble.textContent = message.text;
                if (message.role === 'ai') {
                    row.innerHTML = aiLogoMarkup(28);
                }
                row.appendChild(bubble);
                messages.appendChild(row);
            });
            if (aiMessages.length) {
                var end = doc.createElement('div');
                end.setAttribute('data-ai-messages-end', '');
                end.setAttribute('aria-hidden', 'true');
                messages.appendChild(end);
            }
            messages.scrollTop = messages.scrollHeight;
        }

        function renderAiState() {
            var hasMessages = aiMessages.length > 0;
            var pin = query('[data-action="ai-pin"]');
            var pin_icon = pin.querySelector('.easymde-immersive-icon');
            var mode_icon = query('.easymde-immersive-workspace__ai-mode-icon');

            query('[data-ai-empty]').hidden = hasMessages;
            pin.classList.toggle('is-active', aiPinned);
            pin.setAttribute('aria-pressed', aiPinned ? 'true' : 'false');
            pin_icon.setAttribute('fill', aiPinned ? 'currentColor' : 'none');
            pin.setAttribute(
                'aria-label',
                aiPinned
                    ? (strings.aiUnpin || '取消固定 AI 助手')
                    : (strings.aiPin || '固定 AI 助手')
            );
            root.querySelectorAll('[data-ai-mode]').forEach(function (button) {
                var active = button.getAttribute('data-ai-mode') === aiMode;
                button.classList.toggle('is-active', active);
                button.setAttribute('aria-selected', active ? 'true' : 'false');
            });
            mode_icon.outerHTML = aiMode === 'ask'
                ? iconMarkup('sparkles', 15, 2, 'easymde-immersive-workspace__ai-mode-icon', '#6848f5')
                : iconMarkup('bot', 15, 2, 'easymde-immersive-workspace__ai-mode-icon', '#50607d');
            query('[data-ai-mode-label]').textContent = aiMode === 'ask' ? 'Ask' : 'Agent';
            renderAiMessages();
        }

        function updateAiInputState() {
            var input = query('#easymde-immersive-ai-input');
            var send = query('[data-ai-send]');
            var enabled = !!input.value.trim();

            send.disabled = !enabled;
            send.classList.toggle('is-enabled', enabled);
        }

        function sendAiMessage() {
            var input = query('#easymde-immersive-ai-input');
            var text = input.value.trim();

            if (!text) {
                return;
            }

            aiMessages.push({ role: 'user', text: text });
            aiMessages.push({
                role: 'ai',
                text: strings.aiDemoReply || 'Thank you for your input! This is a demo interface. Once connected to an AI service, real writing suggestions will appear here.'
            });
            input.value = '';
            updateAiInputState();
            renderAiState();
            input.focus();
        }

        function closeAiMenus(restoreFocus) {
            var returnFocus = aiMenuReturnFocus;

            root.querySelectorAll('[data-ai-menu]').forEach(function (menu) {
                menu.hidden = true;
            });
            root.querySelectorAll('[data-action="ai-context"], [data-action="ai-mode"], [data-action="ai-config"]').forEach(function (trigger) {
                trigger.setAttribute('aria-expanded', 'false');
            });
            aiOpenMenu = null;
            aiMenuReturnFocus = null;
            if (restoreFocus && returnFocus && returnFocus.focus) {
                returnFocus.focus();
            }
        }

        function openAiMenu(name, trigger) {
            var menu;

            closeAiMenus(false);
            menu = query('[data-ai-menu="' + name + '"]');
            if (!menu) {
                throw new Error('Unknown AI assistant menu: ' + name);
            }
            aiOpenMenu = name;
            aiMenuReturnFocus = trigger || query('[data-action="ai-config"]');
            menu.hidden = false;
            aiMenuReturnFocus.setAttribute('aria-expanded', 'true');
            if (menu.querySelector('button')) {
                menu.querySelector('button').focus();
            }
        }

        function updateAiModel() {
            var selected = query('[data-ai-model="' + aiModel + '"]');

            root.querySelectorAll('.easymde-immersive-workspace__ai-model-check').forEach(function (check) {
                check.remove();
            });
            root.querySelectorAll('[data-ai-model]').forEach(function (button) {
                var active = button === selected;
                button.classList.toggle('is-active', active);
                button.setAttribute('aria-selected', active ? 'true' : 'false');
            });
            if (selected) {
                selected.insertAdjacentHTML('beforeend', iconMarkup('check', 14, 2, 'easymde-immersive-workspace__ai-model-check', '#6548f5'));
                query('[data-ai-config-model]').textContent = selected.getAttribute('data-ai-model-name');
                query('[data-ai-config-label]').textContent = selected.getAttribute('data-ai-model-name') + ' · ' + query('[data-ai-thinking="' + aiThinkingLength + '"]').getAttribute('data-ai-thinking-label');
            }
        }

        function updateAiThinkingLength() {
            var selected = query('[data-ai-thinking="' + aiThinkingLength + '"]');

            root.querySelectorAll('.easymde-immersive-workspace__ai-thinking-check').forEach(function (check) {
                check.remove();
            });
            root.querySelectorAll('[data-ai-thinking]').forEach(function (button) {
                var active = button === selected;
                button.classList.toggle('is-active', active);
                button.setAttribute('aria-selected', active ? 'true' : 'false');
            });
            if (selected) {
                selected.insertAdjacentHTML('beforeend', iconMarkup('check', 15, 2, 'easymde-immersive-workspace__ai-thinking-check', '#6548f5'));
                query('[data-ai-config-thinking]').textContent = selected.getAttribute('data-ai-thinking-label');
                updateAiModel();
            }
        }

        function setAiAttachment(name) {
            var attachment = query('[data-ai-attachment]');
            var attachment_name;

            attachment.textContent = '';
            if (name) {
                attachment.insertAdjacentHTML('beforeend', iconMarkup('paperclip', 12, 2));
                attachment_name = doc.createElement('span');
                attachment_name.textContent = String(name);
                attachment.appendChild(attachment_name);
                attachment.insertAdjacentHTML('beforeend', iconMarkup('x', 11, 2));
            }
            attachment.hidden = !name;
        }

        function openAi(trigger) {
            var ai = query('.easymde-immersive-workspace__ai');
            var input = query('#easymde-immersive-ai-input');

            closePopovers(false);
            aiMessages = [];
            aiModel = 'deepseek-v3';
            aiMode = 'ask';
            aiThinkingLength = 'standard';
            aiPinned = false;
            aiReturnFocus = trigger || query('[data-action="ai"]');
            input.value = '';
            query('[data-ai-file]').value = '';
            setAiAttachment('');
            closeAiMenus(false);
            updateAiThinkingLength();
            updateAiInputState();
            renderAiState();
            ai.hidden = false;
            query('[data-action="ai"]').setAttribute('aria-expanded', 'true');
            input.focus();
        }

        function closeAi() {
            var ai = query('.easymde-immersive-workspace__ai');
            var returnFocus = aiReturnFocus || query('[data-action="ai"]');

            closeAiMenus(false);
            ai.hidden = true;
            query('[data-action="ai"]').setAttribute('aria-expanded', 'false');
            aiMessages = [];
            aiReturnFocus = null;
            if (returnFocus && returnFocus.focus) {
                returnFocus.focus();
            }
        }

        function handleAction(action, trigger) {
            var popover;
            if (action === 'exit') {
                deactivate();
            } else if (action === 'wechat') {
                runWechatCopy(trigger).catch(function () {
                    // The accessible button state already reports the copy failure.
                });
            } else if (action === 'cancel-table') {
                closeTableDialog();
            } else if (action === 'insert-table') {
                insertSelectedTable(query('[data-table-rows]').value, query('[data-table-columns]').value);
            } else if (action === 'publish') {
                openPublishDialog();
            } else if (action === 'theme' || action === 'font') {
                openAppearance(action, trigger);
            } else if (action === 'history') {
                openHistory(trigger);
            } else if (action === 'history-filter') {
                var historyFilterMenu = query('.easymde-immersive-workspace__history-filter-menu');
                historyFilterMenu.hidden = !historyFilterMenu.hidden;
                trigger.setAttribute('aria-expanded', historyFilterMenu.hidden ? 'false' : 'true');
                if (!historyFilterMenu.hidden) {
                    historyFilterMenu.querySelector('.is-active').focus();
                }
            } else if (action === 'close-history') {
                closeHistory();
            } else if (action === 'restore-history') {
                if (historySelectedId > 0 && typeof adapter.openRevision === 'function') {
                    adapter.openRevision(historySelectedId);
                }
            } else if (action === 'cancel-publish') {
                closePublishDialog();
            } else if (action === 'close-custom-css' || action === 'cancel-custom-css') {
                closeCustomCssDialog();
            } else if (action === 'save-custom-css') {
                saveCustomCss();
            } else if (action === 'confirm-publish') {
                var publishResult;
                if (publishSubmitting) {
                    return;
                }
                updatePublishDraftFromFields();
                if (validatePublishDraft(publishDraft) === 'password-required') {
                    setPublishPasswordError(strings.publishPasswordRequired || 'Enter an access password before submitting.');
                    query('[data-publish-password]').focus();
                    return;
                }
                if (typeof adapter.publish === 'function') {
                    publishSubmitting = true;
                    renderPublishSubmittingState();
                    try {
                        publishResult = adapter.publish(createPublishDraft(publishDraft));
                    } catch (error) {
                        publishSubmitting = false;
                        renderPublishSubmittingState();
                        throw error;
                    }
                    if (publishResult === false) {
                        publishSubmitting = false;
                        renderPublishSubmittingState();
                        return;
                    }
                    return;
                }
                closePublishDialog();
            } else if (action === 'select-featured') {
                if (typeof adapter.selectFeaturedImage === 'function') {
                    updatePublishDraftFromFields();
                    featuredImageTouched = true;
                    adapter.selectFeaturedImage(function (image) {
                        if (!publishDraft) {
                            return;
                        }
                        publishDraft.featuredImage = image && Number(image.id) > 0 ? image : null;
                        renderPublishDialog(false);
                    });
                }
            } else if (action === 'remove-featured') {
                if (publishDraft) {
                    updatePublishDraftFromFields();
                    featuredImageTouched = true;
                    publishDraft.featuredImage = null;
                    renderPublishDialog(false);
                }
            } else if (action === 'settings') {
                popover = query('[data-popover="settings"]');
                if (popover.hidden) {
                    openPopover(popover, trigger);
                } else {
                    closePopovers(true);
                }
            } else if (action === 'statistics') {
                popover = query('[data-popover="statistics"]');
                if (popover.hidden) {
                    openPopover(popover, trigger);
                } else {
                    closePopovers(true);
                }
            } else if (action === 'close-popovers') {
                closePopovers(true);
            } else if (action === 'toggle-outline') {
                if (outlineEnabled) {
                    setOutlineVisible(!outlineVisible);
                }
            } else if (action === 'mobile-preview') {
                root.classList.toggle('is-mobile-preview');
            } else if (action === 'ai') {
                if (query('.easymde-immersive-workspace__ai').hidden) {
                    openAi(trigger);
                } else {
                    closeAi();
                }
            } else if (action === 'close-ai') {
                closeAi();
            } else if (action === 'ai-pin') {
                aiPinned = !aiPinned;
                renderAiState();
            } else if (action === 'ai-context' || action === 'ai-mode' || action === 'ai-config') {
                var menuName = action.replace('ai-', '');
                if (aiOpenMenu === menuName) {
                    closeAiMenus(true);
                } else {
                    openAiMenu(menuName, trigger);
                }
            } else if (action === 'ai-open-model') {
                openAiMenu('model', query('[data-action="ai-config"]'));
            } else if (action === 'ai-open-thinking') {
                openAiMenu('thinking', query('[data-action="ai-config"]'));
            } else if (action === 'ai-config-back') {
                openAiMenu('config', query('[data-action="ai-config"]'));
            } else if (action === 'ai-attachment') {
                closeAiMenus(false);
                query('[data-ai-file]').click();
            } else if (action === 'ai-generate-summary') {
                // The reference UI exposes this as a demo-only AI control.
                return;
            } else if (typeof adapter.performAction === 'function') {
                adapter.performAction(action, { root: root, source: source, preview: preview, title: title });
            }
        }

        function bindUi() {
            root.querySelectorAll('button[data-view]').forEach(function (button) {
                listen(button, 'click', function () {
                    setView(button.getAttribute('data-view'));
                });
            });
            root.querySelectorAll('button[data-action]').forEach(function (button) {
                listen(button, 'click', function () {
                    handleAction(button.getAttribute('data-action'), button);
                });
            });
            root.querySelectorAll('button[data-command]').forEach(function (button) {
                listen(button, 'click', function () {
                    if (button.getAttribute('data-command') === 'table') {
                        openTableDialog(button);
                        return;
                    }
                    if (typeof adapter.executeCommand === 'function') {
                        adapter.executeCommand(button.getAttribute('data-command'), source);
                    }
                });
            });
            listen(outlineNode, 'click', function (event) {
                var button = event.target.closest ? event.target.closest('.easymde-immersive-workspace__outline-entry') : null;
                var offset;
                var index;
                if (!button || !outlineNode.contains(button)) {
                    return;
                }
                offset = parseInt(button.getAttribute('data-offset') || '', 10);
                index = parseInt(button.getAttribute('data-outline-index') || '', 10);
                activeOutlineKey = button.getAttribute('data-outline-key') || '';
                outlineNode.querySelectorAll('.easymde-immersive-workspace__outline-entry').forEach(function (entry) {
                    var active = entry === button;
                    entry.classList.toggle('is-active', active);
                    if (active) {
                        entry.setAttribute('aria-current', 'location');
                    } else {
                        entry.removeAttribute('aria-current');
                    }
                });
                source.focus();
                source.setSelectionRange(offset, offset);
                if (typeof adapter.scrollSourceToOffset === 'function') {
                    adapter.scrollSourceToOffset(source, offset);
                }
                if (typeof adapter.scrollPreviewToHeading === 'function') {
                    adapter.scrollPreviewToHeading(preview, index);
                }
                updateCursor();
            });
            listen(source, 'input', function () {
                if (typeof adapter.setMarkdown === 'function') {
                    adapter.setMarkdown(source.value);
                }
                updateDocumentDerivedState(false);
            });
            listen(source, 'click', updateCursor);
            listen(source, 'keyup', updateCursor);
            listen(source, 'scroll', function () {
                var sourceRange;
                var previewScroller;
                var previewRange;
                if (lineNumbers) {
                    lineNumbers.scrollTop = source.scrollTop;
                }
                if (sourceHighlight) {
                    sourceHighlight.scrollTop = source.scrollTop;
                    sourceHighlight.scrollLeft = source.scrollLeft;
                }
                if (!syncScroll || scrollLock) {
                    return;
                }
                sourceRange = Math.max(1, source.scrollHeight - source.clientHeight);
                previewScroller = query('.easymde-immersive-workspace__preview-scroll');
                previewRange = Math.max(1, previewScroller.scrollHeight - previewScroller.clientHeight);
                scrollLock = true;
                previewScroller.scrollTop = (source.scrollTop / sourceRange) * previewRange;
                win.setTimeout(function () { scrollLock = false; }, 20);
            });
            listen(query('.easymde-immersive-workspace__preview-scroll'), 'scroll', function (event) {
                var previewRange;
                var sourceRange;
                if (!syncScroll || scrollLock) {
                    return;
                }
                previewRange = Math.max(1, event.currentTarget.scrollHeight - event.currentTarget.clientHeight);
                sourceRange = Math.max(1, source.scrollHeight - source.clientHeight);
                scrollLock = true;
                source.scrollTop = (event.currentTarget.scrollTop / previewRange) * sourceRange;
                win.setTimeout(function () { scrollLock = false; }, 20);
            });
            listen(title, 'compositionstart', function () {
                composingTitle = true;
            });
                listen(title, 'compositionend', function () {
                    composingTitle = false;
                    if (typeof adapter.setTitle === 'function') {
                        adapter.setTitle(normalizeTitle(title.value));
                    }
                    updateTitleHeight();
                });
                listen(title, 'input', function () {
                    if (!composingTitle && typeof adapter.setTitle === 'function') {
                        adapter.setTitle(normalizeTitle(title.value));
                    }
                    updateTitleHeight();
                });
            listen(root, 'keydown', function (event) {
                var focusable;
                var first;
                var last;
                var publishDialog = query('.easymde-immersive-workspace__publish');
                var historyDialog = query('.easymde-immersive-workspace__history');
                var customCssDialog = query('.easymde-immersive-workspace__custom-css-modal');
                var tableDialog = query('.easymde-immersive-workspace__table-modal');
                var aiPanel = query('.easymde-immersive-workspace__ai');
                var activeThemeMenu = root.querySelector('.easymde-immersive-workspace__theme-select-menu:not([hidden])');
                var activeFontMenu = root.querySelector('.easymde-immersive-workspace__font-select-menu:not([hidden])');
                var activePopover = root.querySelector('.easymde-immersive-workspace__popover:not([hidden])');
                var historyFilterMenu = query('.easymde-immersive-workspace__history-filter-menu');
                var aiActiveMenu = root.querySelector('[data-ai-menu]:not([hidden])');

                if (
                    event.key !== 'Escape'
                    && event.key !== 'Tab'
                    && typeof adapter.handleShortcut === 'function'
                    && adapter.handleShortcut(event, source)
                ) {
                    event.preventDefault();
                    event.stopPropagation();
                    return;
                }

                if (event.key === 'Escape') {
                    event.preventDefault();
                    event.stopPropagation();
                    if (tableDialog && !tableDialog.hidden) {
                        closeTableDialog();
                    } else if (customCssDialog && !customCssDialog.hidden) {
                        closeCustomCssDialog();
                    } else if (publishDialog && !publishDialog.hidden) {
                        closePublishDialog();
                    } else if (historyFilterMenu && !historyFilterMenu.hidden) {
                        closeHistoryFilter(true);
                    } else if (historyDialog && !historyDialog.hidden) {
                        closeHistory();
                    } else if (aiActiveMenu) {
                        closeAiMenus(true);
                    } else if (aiPanel && !aiPanel.hidden) {
                        closeAi();
                    } else if (activeThemeMenu) {
                        closeThemeSelectMenu(activeThemeMenu, true);
                    } else if (activeFontMenu) {
                        closeFontSelectMenu(activeFontMenu, true);
                    } else if (activePopover) {
                        closePopovers(true);
                    } else {
                        deactivate();
                    }
                    return;
                }

                if (event.key === 'Tab') {
                    focusable = Array.prototype.filter.call(
                        focusScope().querySelectorAll('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'),
                        function (node) {
                            return !!(node.offsetWidth || node.offsetHeight || node.getClientRects().length);
                        }
                    );
                    if (!focusable.length) {
                        return;
                    }
                    first = focusable[0];
                    last = focusable[focusable.length - 1];
                    if (event.shiftKey && doc.activeElement === first) {
                        event.preventDefault();
                        last.focus();
                    } else if (!event.shiftKey && doc.activeElement === last) {
                        event.preventDefault();
                        first.focus();
                    }
                }
            });
            listen(root, 'click', function (event) {
                var activePopover = root.querySelector('.easymde-immersive-workspace__popover:not([hidden])');
                var activeAiMenu = root.querySelector('[data-ai-menu]:not([hidden])');
                var aiMenuOrigin = event.target.closest
                    ? event.target.closest('[data-ai-menu], [data-action="ai-context"], [data-action="ai-mode"], [data-action="ai-config"]')
                    : null;
                var customCssDialog = query('.easymde-immersive-workspace__custom-css-modal');
                var customCssBackdrop = query('[data-custom-css-backdrop]');

                if (activeAiMenu && !aiMenuOrigin) {
                    closeAiMenus(false);
                }
                if (
                    !activePopover
                    || (customCssDialog && customCssDialog.contains(event.target))
                    || (customCssBackdrop && customCssBackdrop.contains(event.target))
                    || activePopover.contains(event.target)
                    || (popoverTrigger && popoverTrigger.contains(event.target))
                ) {
                    return;
                }
                closePopovers(false);
            });
            listen(win, 'resize', positionSettingsPopover);
            listen(win, 'scroll', positionSettingsPopover, true);
            listen(win, 'resize', positionAppearancePopover);
            listen(win, 'scroll', positionAppearancePopover, true);
            listen(query('[data-ai-form]'), 'submit', function (event) {
                event.preventDefault();
                sendAiMessage();
            });
            listen(query('#easymde-immersive-ai-input'), 'input', updateAiInputState);
            listen(query('#easymde-immersive-ai-input'), 'keydown', function (event) {
                if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    sendAiMessage();
                }
            });
            listen(query('[data-ai-file]'), 'change', function (event) {
                setAiAttachment(event.target.files && event.target.files[0] ? event.target.files[0].name : '');
            });
            listen(query('[data-ai-attachment]'), 'click', function () {
                query('[data-ai-file]').value = '';
                setAiAttachment('');
            });
            root.querySelectorAll('[data-ai-prompt]').forEach(function (button) {
                listen(button, 'click', function () {
                    var input = query('#easymde-immersive-ai-input');
                    input.value = button.getAttribute('data-ai-prompt') || '';
                    updateAiInputState();
                    input.focus();
                });
            });
            root.querySelectorAll('[data-ai-skill]').forEach(function (button) {
                listen(button, 'click', function () {
                    var input = query('#easymde-immersive-ai-input');
                    input.value = '@' + (button.getAttribute('data-ai-skill') || '') + ' ';
                    updateAiInputState();
                    closeAiMenus(false);
                    input.focus();
                });
            });
            root.querySelectorAll('[data-ai-mode]').forEach(function (button) {
                listen(button, 'click', function () {
                    aiMode = button.getAttribute('data-ai-mode') || 'ask';
                    renderAiState();
                    closeAiMenus(true);
                });
            });
            root.querySelectorAll('[data-ai-model]').forEach(function (button) {
                listen(button, 'click', function () {
                    aiModel = button.getAttribute('data-ai-model') || 'deepseek-v3';
                    updateAiModel();
                    openAiMenu('config', query('[data-action="ai-config"]'));
                });
            });
            root.querySelectorAll('[data-ai-thinking]').forEach(function (button) {
                listen(button, 'click', function () {
                    aiThinkingLength = button.getAttribute('data-ai-thinking') || 'standard';
                    updateAiThinkingLength();
                    openAiMenu('config', query('[data-action="ai-config"]'));
                });
            });
                listen(query('.easymde-immersive-workspace__publish'), 'click', function (event) {
                    var categoryToggle = event.target.closest ? event.target.closest('[data-publish-category-toggle]') : null;
                    var remove = event.target.closest ? event.target.closest('[data-publish-remove-tag]') : null;
                    var index;

                    if (categoryToggle) {
                        var categoryId = categoryToggle.getAttribute('data-publish-category-toggle') || '';
                        publishCategoryCollapsed[categoryId] = !publishCategoryCollapsed[categoryId];
                        renderPublishCategories();
                        query('[data-publish-category-toggle="' + categoryId + '"]').focus();
                        return;
                    }

                    if (!remove || !publishDraft) {
                    return;
                }
                index = parseInt(remove.getAttribute('data-publish-remove-tag') || '', 10);
                if (!isFinite(index) || index < 0 || index >= publishDraft.tags.length) {
                    return;
                }
                publishDraft.tags.splice(index, 1);
                renderPublishTags();
                query('[data-publish-tag-input]').focus();
            });
            listen(query('[data-publish-tag-input]'), 'keydown', function (event) {
                if (event.key === 'Enter' || event.key === ',' || event.key === '，') {
                    event.preventDefault();
                    commitPublishTagInput();
                } else if (event.key === 'Backspace' && !event.currentTarget.value && publishDraft && publishDraft.tags.length) {
                    publishDraft.tags.pop();
                    renderPublishTags();
                }
            });
            listen(query('[data-publish-tag-input]'), 'paste', function (event) {
                var text = event.clipboardData ? event.clipboardData.getData('text') : '';
                if (!/[,，\n]/.test(text)) {
                    return;
                }
                event.preventDefault();
                event.currentTarget.value = text;
                commitPublishTagInput();
            });
            listen(query('[data-publish-tag-input]'), 'blur', commitPublishTagInput);
            listen(query('[data-publish-excerpt]'), 'input', updatePublishCounts);
                listen(query('[data-publish-categories]'), 'change', function (event) {
                    var input = event.target.closest ? event.target.closest('[data-publish-category]') : null;
                    var categoryId;

                    if (!input || !publishDraft) {
                        return;
                    }
                    categoryId = input.value;
                    publishDraft.categories = Array.prototype.map.call(
                        root.querySelectorAll('[data-publish-category]:checked'),
                        function (categoryInput) { return categoryInput.value; }
                    );
                    renderPublishCategories();
                    query('[data-publish-category][value="' + categoryId + '"]').focus();
                    updatePublishCounts();
                });
            listen(query('.easymde-immersive-workspace__publish-visibility-options'), 'change', function (event) {
                var input = event.target.closest ? event.target.closest('[data-publish-visibility]') : null;

                if (!input || !publishDraft) {
                    return;
                }
                publishDraft.visibility = input.value;
                publishDraft.password = input.value === 'password' ? publishDraft.password : '';
                publishDraft.sticky = input.value === 'public' ? publishDraft.sticky : false;
                setPublishPasswordError('');
                renderPublishVisibility();
            });
            listen(query('[data-publish-sticky]'), 'change', function (event) {
                if (publishDraft && publishDraft.visibility === 'public') {
                    publishDraft.sticky = event.target.checked;
                }
            });
            listen(query('[data-publish-preview]'), 'change', function (event) {
                if (publishDraft) {
                    publishDraft.openPreview = event.target.checked;
                    renderPublishPreviewState();
                }
            });
            listen(query('[data-publish-password]'), 'input', function (event) {
                if (publishDraft && publishDraft.visibility === 'password') {
                    publishDraft.password = event.target.value;
                    if (event.target.value.trim()) {
                        setPublishPasswordError('');
                    }
                }
            });
            listen(query('[data-publish-backdrop]'), 'click', closeActiveModal);
            listen(query('[data-table-backdrop]'), 'click', function () { closeTableDialog(); });
            listen(query('[data-history-backdrop]'), 'click', closeHistory);
            listen(query('[data-custom-css-backdrop]'), 'click', closeCustomCssDialog);
            listen(query('[data-custom-css-name]'), 'input', function () {
                setCustomCssSaveLabel(false);
                updateCustomCssSaveButton();
            });
            listen(query('[data-custom-css-code]'), 'input', function (event) {
                setCustomCssSaveLabel(false);
                scheduleCustomCssPreview(event.currentTarget.value, false);
            });
            listen(query('[data-table-rows]'), 'input', function () {
                try {
                    setTableSelection(query('[data-table-rows]').value, query('[data-table-columns]').value);
                } catch (error) {
                    var errorNode = query('[data-table-error]');
                    errorNode.textContent = error.message;
                    errorNode.hidden = false;
                }
            });
            listen(query('[data-table-columns]'), 'input', function () {
                try {
                    setTableSelection(query('[data-table-rows]').value, query('[data-table-columns]').value);
                } catch (error) {
                    var errorNode = query('[data-table-error]');
                    errorNode.textContent = error.message;
                    errorNode.hidden = false;
                }
            });
            root.querySelectorAll('[data-setting]').forEach(function (button) {
                listen(button, 'click', function () {
                    var setting = button.getAttribute('data-setting');
                    var enabled = button.getAttribute('aria-checked') !== 'true';
                    if (setting === 'outline') {
                        setOutlineEnabled(enabled);
                    } else if (setting === 'word-count') {
                        setWordCountVisible(enabled);
                    } else if (setting === 'split') {
                        setView(enabled ? 'split' : 'edit');
                    } else if (setting === 'auto-save') {
                        setLocalDraftsStatus(enabled, true);
                    } else if (setting === 'sync') {
                        setSyncScrollEnabled(enabled);
                    } else if (setting === 'ai-autocomplete') {
                        setSettingSwitch('ai-autocomplete', enabled);
                    }
                });
            });
            root.querySelectorAll('[data-history-filter]').forEach(function (button) {
                listen(button, 'click', function () {
                    historyFilter = button.getAttribute('data-history-filter') || 'all';
                    closeHistoryFilter(true);
                    renderHistoryList();
                });
            });
            bindDivider();
            bindOutlineResizer();
        }

        function activate() {
            var wpWrap;
            var unsubscribeTitle;
            if (root || !doc || !doc.body || !doc.createElement) {
                return false;
            }
            previousFocus = doc.activeElement;
            previousScroll = { x: win.pageXOffset || 0, y: win.pageYOffset || 0 };
            root = doc.createElement('div');
            root.className = ROOT_CLASS + ' is-outline-hidden';
            root.setAttribute('role', 'dialog');
            root.setAttribute('aria-modal', 'true');
            root.setAttribute('aria-label', strings.workspaceLabel || 'EasyMDE immersive writing workspace');
            root.innerHTML = workspaceMarkup(strings);
            if (typeof adapter.decorateWechatIcon === 'function') {
                try {
                    adapter.decorateWechatIcon(root);
                } catch (error) {
                    root = null;
                    throw error;
                }
            }
            doc.body.appendChild(root);
            doc.documentElement.classList.add(ACTIVE_CLASS);
            doc.body.classList.add(ACTIVE_CLASS);
            source = query('.easymde-immersive-workspace__source');
            title = query('.easymde-immersive-workspace__title');
            preview = query('.easymde-immersive-workspace__preview');
            main = query('.easymde-immersive-workspace__main');
            toolbar = query('.easymde-immersive-workspace__toolbar');
            outlineNode = query('.easymde-immersive-workspace__outline');
            statsNode = query('[data-popover="statistics"]');
            cursorNode = query('.easymde-immersive-workspace__cursor');
            divider = query('.easymde-immersive-workspace__divider');
            outlineResizer = query('.easymde-immersive-workspace__outline-resizer');
            lineNumbers = query('.easymde-immersive-workspace__line-numbers');
            sourceHighlight = query('.easymde-immersive-workspace__source-highlight');
            source.value = typeof adapter.getMarkdown === 'function' ? adapter.getMarkdown() : '';
            title.value = typeof adapter.getTitle === 'function' ? adapter.getTitle() : '';
            if (typeof adapter.getPublishState === 'function') {
                publishState = adapter.getPublishState();
                updatePublishButton(createPublishDraft(publishState).mode);
                publishState = null;
            }
            bindUi();
            setOutlineEnabled(true);
            setOutlineVisible(false);
            setWordCountVisible(true);
            setView('split');
            setSyncScrollEnabled(true);
            setLocalDraftsStatus(
                typeof adapter.getLocalDraftsEnabled === 'function'
                    ? adapter.getLocalDraftsEnabled()
                    : true,
                false
            );
            setSourceRatio(restoreSourceRatio());
            setOutlineWidth(restoreOutlineWidth());
            updateTitleHeight();
            updateDocumentDerivedState(true);
            if (source && source.focus) {
                try {
                    source.focus({ preventScroll: true });
                } catch (error) {
                    source.focus();
                }
            }
            wpWrap = doc.getElementById ? doc.getElementById('wpwrap') : null;
            if (wpWrap) {
                previousWpWrapHadInert = wpWrap.hasAttribute('inert');
                previousWpWrapInert = !!wpWrap.inert;
                wpWrap.inert = true;
            }
            if (typeof adapter.subscribeTitle === 'function') {
                unsubscribeTitle = adapter.subscribeTitle(syncExternalTitle);
                if (typeof unsubscribeTitle === 'function') {
                    listeners.push(unsubscribeTitle);
                }
            }
            if (typeof adapter.onActivate === 'function') {
                adapter.onActivate({ root: root, source: source, preview: preview, title: title });
            }
            return true;
        }

        function deactivate() {
            var wpWrap;
            var workspaceContext;
            if (!root) {
                return false;
            }
            workspaceContext = { root: root, source: source, preview: preview, title: title };
            cancelDocumentDerivedState();
            if (outlineResizeCleanup) {
                outlineResizeCleanup();
            }
            clearWechatFeedbackTimer();
            clearCustomCssTimers();
            customCssPreviewSequence += 1;
            listeners.splice(0).forEach(function (remove) {
                remove();
            });
            wpWrap = doc.getElementById ? doc.getElementById('wpwrap') : null;
            if (wpWrap) {
                wpWrap.inert = previousWpWrapInert;
                if (!previousWpWrapHadInert) {
                    wpWrap.removeAttribute('inert');
                }
            }
            root.remove();
            root = null;
            source = null;
            title = null;
            preview = null;
            main = null;
            toolbar = null;
            outlineNode = null;
            statsNode = null;
            cursorNode = null;
            divider = null;
            outlineResizer = null;
            lineNumbers = null;
            renderedLineCount = 0;
            popoverTrigger = null;
            customCssState = null;
            customCssReturnFocus = null;
            customCssSubmitting = false;
            customCssPreviewValid = false;
            publishSubmitting = false;
            wechatCopying = false;
            doc.documentElement.classList.remove(ACTIVE_CLASS);
            doc.body.classList.remove(ACTIVE_CLASS);
            if (previousScroll && win.scrollTo) {
                win.scrollTo(previousScroll.x, previousScroll.y);
            }
            if (previousFocus && previousFocus.focus) {
                previousFocus.focus({ preventScroll: true });
            }
            if (typeof adapter.onDeactivate === 'function') {
                adapter.onDeactivate(workspaceContext);
            }
            return true;
        }

        return {
            activate: activate,
            deactivate: deactivate,
            isActive: function () { return !!root; },
            setView: setView
        };
    }

    window.EasyMDEImmersiveWorkspace = {
        calculateStats: calculateStats,
        calculateSourceRatioFromPointer: calculateSourceRatioFromPointer,
        clampOutlineWidth: clampOutlineWidth,
        createTableMarkdown: createTableMarkdown,
        createPublishCategoryTree: createPublishCategoryTree,
        createPublishDraft: createPublishDraft,
        createController: createController,
        findFirstLocalImageCandidate: findFirstLocalImageCandidate,
        getOutlineIconName: getOutlineIconName,
        normalizeTitle: normalizeTitle,
        normalizeTableDimensions: normalizeTableDimensions,
        parseOutline: parseOutline,
        validatePublishDraft: validatePublishDraft
    };
}(window, document));
