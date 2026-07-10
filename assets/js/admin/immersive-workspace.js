(function (window, document) {
    'use strict';

    var ROOT_CLASS = 'easymde-immersive-workspace';
    var ACTIVE_CLASS = 'easymde-immersive-workspace-active';

    function normalizeLineEndings(value) {
        return String(value || '').replace(/\r\n?/g, '\n');
    }

    function normalizeTitle(value) {
        return normalizeLineEndings(value).replace(/[ \t\f\v]*\n+[ \t\f\v]*/g, ' ');
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

    function createPublishDraft(options) {
        options = options || {};
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
            mode: ['publish', 'future', 'private'].indexOf(String(options.postStatus || '').toLowerCase()) !== -1
                ? 'update'
                : 'publish',
            openPreview: !!options.openPreview,
            tags: uniqueStrings(options.tags || [], true)
        };
    }

    function parseOutline(markdown) {
        var normalized = normalizeLineEndings(markdown);
        var lines = normalized.split('\n');
        var outline = [];
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

        return outline;
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

    function workspaceMarkup(strings) {
        var label = function (key, fallback) {
            return escapeHtml(strings && strings[key] ? strings[key] : fallback);
        };

        return '' +
            '<div class="easymde-immersive-workspace__shell">' +
                '<header class="easymde-immersive-workspace__header">' +
                    '<div class="easymde-immersive-workspace__brand" aria-label="EasyMDE">' +
                        '<span class="easymde-immersive-workspace__traffic" aria-hidden="true"><i></i><i></i><i></i></span>' +
                        '<span class="easymde-immersive-workspace__brand-mark dashicons dashicons-edit" aria-hidden="true"></span>' +
                        '<strong>EasyMDE</strong>' +
                    '</div>' +
                    '<textarea id="easymde-immersive-title" name="easymde_immersive_title" class="easymde-immersive-workspace__title" rows="1" aria-label="' + label('postTitle', 'Post title') + '" placeholder="' + label('postTitlePlaceholder', 'Article title...') + '"></textarea>' +
                    '<nav class="easymde-immersive-workspace__primary-actions" aria-label="' + label('editorActions', 'Editor actions') + '">' +
                        '<button type="button" data-view="edit"><span class="dashicons dashicons-edit" aria-hidden="true"></span>' + label('editMode', 'Edit') + '</button>' +
                        '<button type="button" data-view="split" class="is-active"><span class="dashicons dashicons-columns" aria-hidden="true"></span>' + label('splitMode', 'Split') + '</button>' +
                        '<button type="button" data-view="preview"><span class="dashicons dashicons-visibility" aria-hidden="true"></span>' + label('previewMode', 'Preview') + '</button>' +
                        '<span class="easymde-immersive-workspace__action-separator" aria-hidden="true"></span>' +
                        '<button type="button" data-action="theme"><span class="dashicons dashicons-art" aria-hidden="true"></span>' + label('theme', 'Theme') + '</button>' +
                        '<button type="button" data-action="font"><span class="easymde-immersive-workspace__text-icon" aria-hidden="true">T</span>' + label('font', 'Font') + '</button>' +
                        '<button type="button" data-action="history"><span class="dashicons dashicons-backup" aria-hidden="true"></span>' + label('history', 'History') + '</button>' +
                        '<button type="button" data-action="copy-markdown"><span class="dashicons dashicons-admin-page" aria-hidden="true"></span>' + label('copyMarkdown', 'Copy Markdown') + '</button>' +
                        '<button type="button" data-action="ai" aria-expanded="false" class="easymde-immersive-workspace__ai-button"><span class="dashicons dashicons-superhero-alt" aria-hidden="true"></span>' + label('aiAssistant', 'AI Assistant') + '</button>' +
                        '<button type="button" data-action="save"><span class="dashicons dashicons-saved" aria-hidden="true"></span>' + label('save', 'Save') + '</button>' +
                        '<button type="button" data-action="publish" class="easymde-immersive-workspace__publish-button"><span class="dashicons dashicons-upload" aria-hidden="true"></span><span data-publish-label>' + label('publishArticle', 'Publish article') + '</span></button>' +
                    '</nav>' +
                '</header>' +
                '<div class="easymde-immersive-workspace__toolbar" role="toolbar" aria-label="' + label('markdownToolbar', 'Markdown toolbar') + '">' +
                    '<div class="easymde-immersive-workspace__format-actions">' +
                        '<button type="button" data-command="bold" aria-label="Bold"><span class="dashicons dashicons-editor-bold" aria-hidden="true"></span></button>' +
                        '<button type="button" data-command="italic" aria-label="Italic"><span class="dashicons dashicons-editor-italic" aria-hidden="true"></span></button>' +
                        '<button type="button" data-command="strike" aria-label="Strikethrough"><span class="dashicons dashicons-editor-strikethrough" aria-hidden="true"></span></button>' +
                        '<i aria-hidden="true"></i>' +
                        '<button type="button" data-command="heading" aria-label="Heading"><span class="easymde-toolbar-text-icon" aria-hidden="true">H</span></button>' +
                        '<button type="button" data-command="quote" aria-label="Blockquote"><span class="dashicons dashicons-format-quote" aria-hidden="true"></span></button>' +
                        '<button type="button" data-command="unorderedlist" aria-label="Bullet list"><span class="dashicons dashicons-editor-ul" aria-hidden="true"></span></button>' +
                        '<button type="button" data-command="orderedlist" aria-label="Numbered list"><span class="dashicons dashicons-editor-ol" aria-hidden="true"></span></button>' +
                        '<i aria-hidden="true"></i>' +
                        '<button type="button" data-command="inlinecode" aria-label="Inline code"><span class="dashicons dashicons-editor-code" aria-hidden="true"></span></button>' +
                        '<button type="button" data-command="codefence" aria-label="Code block"><span class="easymde-toolbar-text-icon" aria-hidden="true">&lt;/&gt;</span></button>' +
                        '<i aria-hidden="true"></i>' +
                        '<button type="button" data-command="link" aria-label="Link"><span class="dashicons dashicons-admin-links" aria-hidden="true"></span></button>' +
                        '<button type="button" data-command="image" aria-label="Image"><span class="dashicons dashicons-format-image" aria-hidden="true"></span></button>' +
                        '<button type="button" data-command="table" aria-label="' + label('table', 'Table') + '"><span class="dashicons dashicons-grid-view" aria-hidden="true"></span></button>' +
                        '<i aria-hidden="true"></i>' +
                        '<button type="button" data-view="edit" aria-label="' + label('editMode', 'Edit') + '"><span class="dashicons dashicons-editor-alignleft" aria-hidden="true"></span></button>' +
                        '<button type="button" data-view="split" class="is-active" aria-label="' + label('splitMode', 'Split') + '"><span class="dashicons dashicons-grid-view" aria-hidden="true"></span></button>' +
                        '<button type="button" data-view="preview" aria-label="' + label('previewMode', 'Preview') + '"><span class="dashicons dashicons-visibility" aria-hidden="true"></span></button>' +
                        '<button type="button" data-action="exit" aria-label="' + label('exitImmersive', 'Exit immersive writing') + '"><span class="dashicons dashicons-fullscreen-exit-alt" aria-hidden="true"></span></button>' +
                    '</div>' +
                    '<div class="easymde-immersive-workspace__secondary-actions">' +
                        '<button type="button" data-action="wechat" class="easymde-immersive-workspace__wechat-button"><span data-wechat-icon aria-hidden="true"></span>' + label('copyWechat', 'Copy to WeChat') + '</button>' +
                        '<button type="button" data-action="mobile-preview"><span class="dashicons dashicons-smartphone" aria-hidden="true"></span>' + label('mobilePreview', 'Mobile') + '</button>' +
                        '<button type="button" data-action="toggle-outline" aria-expanded="false" aria-controls="easymde-immersive-outline-card"><span class="dashicons dashicons-list-view" aria-hidden="true"></span>' + label('outline', 'Outline') + '</button>' +
                        '<button type="button" data-action="statistics" aria-expanded="false" aria-controls="easymde-immersive-statistics"><span class="dashicons dashicons-chart-bar" aria-hidden="true"></span>' + label('statistics', 'Statistics') + '</button>' +
                        '<button type="button" data-action="settings" aria-expanded="false"><span class="dashicons dashicons-admin-generic" aria-hidden="true"></span>' + label('settings', 'Settings') + '</button>' +
                    '</div>' +
                '</div>' +
                '<main class="easymde-immersive-workspace__main" data-view="split">' +
                    '<aside id="easymde-immersive-outline-card" class="easymde-immersive-workspace__outline-card">' +
                        '<header><strong>' + label('outline', 'Outline') + '</strong><button type="button" data-action="toggle-outline" aria-label="' + label('closeOutline', 'Close outline') + '">&times;</button></header>' +
                        '<nav class="easymde-immersive-workspace__outline" aria-label="' + label('outline', 'Outline') + '"></nav>' +
                        '<footer><button type="button" data-action="settings">' + label('outlineSettings', 'Outline settings') + '</button></footer>' +
                    '</aside>' +
                    '<section class="easymde-immersive-workspace__editor-card">' +
                        '<header><strong>MARKDOWN</strong><span aria-hidden="true">...</span></header>' +
                        '<div class="easymde-immersive-workspace__editor-body"><div class="easymde-immersive-workspace__line-numbers" aria-hidden="true"></div><textarea id="easymde-immersive-source" name="easymde_immersive_markdown" class="easymde-immersive-workspace__source" spellcheck="false" wrap="off"></textarea></div>' +
                        '<footer><span class="easymde-immersive-workspace__cursor">' + label('lineColumn', 'Line 1, Column 1') + '</span><span>Markdown <i></i> ' + label('localDraftsEnabled', 'Local drafts enabled') + '</span></footer>' +
                    '</section>' +
                    '<div class="easymde-immersive-workspace__divider" role="separator" tabindex="0" aria-orientation="vertical" aria-valuemin="25" aria-valuemax="75" aria-valuenow="50"></div>' +
                    '<section class="easymde-immersive-workspace__preview-card">' +
                        '<header><strong>' + label('previewMode', 'Preview') + '</strong><span aria-hidden="true">...</span></header>' +
                        '<div class="easymde-immersive-workspace__preview-scroll"><article class="easymde-immersive-workspace__preview" aria-live="polite"></article></div>' +
                    '</section>' +
                '</main>' +
                '<div class="easymde-immersive-workspace__popover" data-popover="settings" hidden>' +
                    '<header><strong>' + label('settings', 'Settings') + '</strong><button type="button" data-action="close-popovers" aria-label="' + label('close', 'Close') + '">&times;</button></header>' +
                    '<label class="easymde-immersive-workspace__outline-setting"><span><strong>' + label('outline', 'Outline') + '</strong><small>' + label('outlineHelp', 'Show heading navigation') + '</small></span><input id="easymde-immersive-setting-outline" name="easymde_immersive_setting_outline" type="checkbox" data-setting="outline"></label>' +
                    '<label><span><strong>' + label('splitPreview', 'Split preview') + '</strong><small>' + label('splitPreviewHelp', 'Show source and preview') + '</small></span><input id="easymde-immersive-setting-split" name="easymde_immersive_setting_split" type="checkbox" data-setting="split" checked></label>' +
                    '<label><span><strong>' + label('syncScroll', 'Sync scrolling') + '</strong><small>' + label('syncScrollHelp', 'Link source and preview scrolling') + '</small></span><input id="easymde-immersive-setting-sync" name="easymde_immersive_setting_sync" type="checkbox" data-setting="sync" checked></label>' +
                '</div>' +
                '<div class="easymde-immersive-workspace__popover easymde-immersive-workspace__appearance" data-popover="appearance" hidden>' +
                    '<header><strong data-appearance-title></strong><button type="button" data-action="close-popovers" aria-label="' + label('close', 'Close') + '">&times;</button></header>' +
                    '<div data-appearance-fields></div>' +
                '</div>' +
                '<div id="easymde-immersive-statistics" class="easymde-immersive-workspace__popover easymde-immersive-workspace__statistics" data-popover="statistics" hidden>' +
                    '<header><strong>' + label('statistics', 'Writing statistics') + '</strong><button type="button" data-action="close-popovers" aria-label="' + label('close', 'Close') + '">&times;</button></header>' +
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
                    '<header><strong>' + label('aiAssistant', 'AI Assistant') + '</strong><button type="button" data-action="close-ai" aria-label="' + label('close', 'Close') + '">&times;</button></header>' +
                    '<div><p>' + label('aiDemoMessage', 'This is a local interface preview. It is not connected to article data or a network service.') + '</p></div>' +
                    '<form><input id="easymde-immersive-ai-input" name="easymde_immersive_ai_input" type="text" aria-label="' + label('aiDemoInput', 'AI demo input') + '" placeholder="' + label('aiDemoPlaceholder', 'Enter a demo question...') + '"><button type="submit">' + label('send', 'Send') + '</button></form>' +
                '</aside>' +
                '<div class="easymde-immersive-workspace__modal-backdrop" data-publish-backdrop hidden></div>' +
                '<section class="easymde-immersive-workspace__publish" role="dialog" aria-modal="true" aria-labelledby="easymde-immersive-publish-title" hidden>' +
                    '<header><div><strong id="easymde-immersive-publish-title"></strong><small data-publish-summary></small></div><button type="button" data-action="cancel-publish" aria-label="' + label('close', 'Close') + '">&times;</button></header>' +
                    '<div class="easymde-immersive-workspace__publish-body">' +
                        '<label class="easymde-immersive-workspace__publish-field"><strong>' + label('publishTags', 'Tags') + '</strong><input id="easymde-immersive-publish-tags" name="easymde_immersive_publish_tags" type="text" data-publish-tags></label>' +
                        '<div class="easymde-immersive-workspace__publish-field"><strong>' + label('publishFeaturedImage', 'Featured image') + '</strong><div class="easymde-immersive-workspace__featured"><span data-featured-summary></span><button type="button" data-action="select-featured">' + label('selectFeaturedImage', 'Select image') + '</button><button type="button" data-action="remove-featured">' + label('removeFeaturedImage', 'Remove') + '</button></div></div>' +
                        '<label class="easymde-immersive-workspace__publish-field"><strong>' + label('publishExcerpt', 'Excerpt') + '</strong><textarea id="easymde-immersive-publish-excerpt" name="easymde_immersive_publish_excerpt" rows="4" data-publish-excerpt></textarea></label>' +
                        '<div class="easymde-immersive-workspace__publish-field"><strong>' + label('publishCategories', 'Categories') + '</strong><div class="easymde-immersive-workspace__categories" data-publish-categories></div></div>' +
                        '<label class="easymde-immersive-workspace__publish-preview"><input id="easymde-immersive-publish-preview" name="easymde_immersive_publish_preview" type="checkbox" data-publish-preview><span>' + label('publishPreviewAfter', 'Open preview after publishing') + '</span></label>' +
                    '</div>' +
                    '<footer><button type="button" data-action="cancel-publish">' + label('cancel', 'Cancel') + '</button><button type="button" data-action="confirm-publish" class="is-primary" data-publish-confirm></button></footer>' +
                '</section>' +
                '<section class="easymde-immersive-workspace__history" role="dialog" aria-modal="true" aria-labelledby="easymde-immersive-history-title" hidden>' +
                    '<header><div><strong id="easymde-immersive-history-title">' + label('history', 'History') + '</strong><small>' + label('historyHelp', 'WordPress revisions for this article') + '</small></div><button type="button" data-action="close-history" aria-label="' + label('close', 'Close') + '">&times;</button></header>' +
                    '<div data-history-list></div>' +
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
        var outlineNode = null;
        var statsNode = null;
        var cursorNode = null;
        var divider = null;
        var lineNumbers = null;
        var previousFocus = null;
        var previousScroll = null;
        var previousWpWrapInert = false;
        var previousWpWrapHadInert = false;
        var sourceRatio = 0.5;
        var listeners = [];
        var composingTitle = false;
        var viewMode = 'split';
        var activeOutlineKey = '';
        var publishDraft = null;
        var publishState = null;
        var publishSequence = 0;
        var featuredImageTouched = false;
        var syncScroll = true;
        var scrollLock = false;
        var derivedFrame = null;
        var derivedFrameIsTimeout = false;
        var renderedLineCount = 0;
        var popoverTrigger = null;

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
            if (!title || !title.style) {
                return;
            }
            title.style.height = '0px';
            title.style.height = String(title.scrollHeight || 34) + 'px';
        }

        function syncExternalTitle(value) {
            var normalized = normalizeTitle(value);
            if (!title || composingTitle || title.value === normalized) {
                return;
            }
            title.value = normalized;
            updateTitleHeight();
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

            if (!statsNode) {
                return;
            }
            statsNode.querySelectorAll('[data-stat]').forEach(function (node) {
                node.textContent = String(values[node.getAttribute('data-stat')] || 0);
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

        function renderOutline() {
            var entries = parseOutline(source ? source.value : '');
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
            entries.forEach(function (entry) {
                var button = doc.createElement('button');
                var marker = doc.createElement('span');
                var textNode = doc.createElement('span');
                button.type = 'button';
                button.className = 'easymde-immersive-workspace__outline-entry';
                if (entry.key === activeOutlineKey) {
                    button.classList.add('is-active');
                    button.setAttribute('aria-current', 'location');
                }
                button.style.setProperty('--easymde-outline-level', String(entry.level));
                marker.className = entry.level === 1
                    ? 'easymde-immersive-workspace__outline-icon dashicons dashicons-media-document'
                    : 'easymde-immersive-workspace__outline-connector';
                marker.setAttribute('aria-hidden', 'true');
                textNode.className = 'easymde-immersive-workspace__outline-text';
                textNode.textContent = entry.text;
                button.appendChild(marker);
                button.appendChild(textNode);
                button.setAttribute('data-offset', String(entry.offset));
                button.setAttribute('data-outline-key', entry.key);
                button.setAttribute('data-outline-index', String(outlineNode.childNodes.length));
                outlineNode.appendChild(button);
            });
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
            root.querySelectorAll('[data-view]').forEach(function (button) {
                if (button.tagName === 'BUTTON') {
                    button.classList.toggle('is-active', button.getAttribute('data-view') === mode);
                }
            });
        }

        function setSourceRatio(ratio) {
            sourceRatio = Math.max(0.25, Math.min(0.75, Number(ratio) || 0.5));
            main.style.setProperty('--easymde-immersive-source-ratio', String(sourceRatio));
            divider.setAttribute('aria-valuenow', String(Math.round(sourceRatio * 100)));
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
                return 0.62;
            }
            try {
                stored = parseFloat(storage.getItem(layoutKey));
            } catch (error) {
                return 0.62;
            }
            return isFinite(stored) ? stored : 0.62;
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

        function bindDivider() {
            var pointerId = null;

            listen(divider, 'pointerdown', function (event) {
                pointerId = event.pointerId;
                if (divider.setPointerCapture) {
                    divider.setPointerCapture(pointerId);
                }
                event.preventDefault();
            });
            listen(divider, 'pointermove', function (event) {
                var rect;
                if (pointerId === null || event.pointerId !== pointerId) {
                    return;
                }
                rect = main.getBoundingClientRect();
                if (rect.width) {
                    setSourceRatio((event.clientX - rect.left) / rect.width);
                }
            });
            listen(divider, 'pointerup', function (event) {
                if (event.pointerId === pointerId) {
                    pointerId = null;
                    persistSourceRatio();
                }
            });
            listen(divider, 'pointercancel', function (event) {
                if (event.pointerId === pointerId) {
                    pointerId = null;
                }
            });
            listen(divider, 'lostpointercapture', function () {
                pointerId = null;
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
            });
        }

        function closePopovers(restoreFocus) {
            var trigger = popoverTrigger;
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
        }

        function setOutlineVisible(visible) {
            var outlineSetting = query('[data-setting="outline"]');
            root.classList.toggle('is-outline-hidden', !visible);
            if (outlineSetting) {
                outlineSetting.checked = !!visible;
            }
            root.querySelectorAll('[data-action="toggle-outline"]').forEach(function (button) {
                button.setAttribute('aria-expanded', visible ? 'true' : 'false');
            });
        }

        function appendAppearanceSelect(container, labelText, key, options, selected) {
            var label = doc.createElement('label');
            var titleNode = doc.createElement('strong');
            var select = doc.createElement('select');
            var fieldKey = String(key || '').replace(/([A-Z])/g, '-$1').toLowerCase();

            titleNode.textContent = labelText;
            select.id = 'easymde-immersive-appearance-' + fieldKey;
            select.name = 'easymde_immersive_appearance_' + fieldKey.replace(/-/g, '_');
            select.setAttribute('data-appearance-key', key);
            (options || []).forEach(function (option) {
                var item = doc.createElement('option');
                item.value = String(option.id || '');
                item.textContent = String(option.label || option.id || '');
                select.appendChild(item);
            });
            select.value = String(selected || '');
            label.appendChild(titleNode);
            label.appendChild(select);
            container.appendChild(label);
            listen(select, 'change', function () {
                var changes = {};
                changes[key] = select.value;
                if (typeof adapter.updateAppearance === 'function') {
                    adapter.updateAppearance(changes, { preview: preview, markdown: source.value });
                }
            });
        }

        function openAppearance(kind, trigger) {
            var popover = query('[data-popover="appearance"]');
            var fields = query('[data-appearance-fields]');
            var data = typeof adapter.getAppearanceOptions === 'function'
                ? adapter.getAppearanceOptions()
                : { state: {}, themes: [], codeThemes: [], fonts: {} };
            var state = data.state || {};

            closePopovers(false);
            fields.textContent = '';
            query('[data-appearance-title]').textContent = kind === 'font'
                ? (strings.font || 'Font')
                : (strings.theme || 'Theme');
            if (kind === 'font') {
                appendAppearanceSelect(fields, strings.customFont || 'Custom font', 'customFont', data.fonts.customFonts, state.customFont);
                appendAppearanceSelect(fields, strings.windowsFont || 'Windows font', 'windowsFont', data.fonts.windowsFonts, state.windowsFont);
                appendAppearanceSelect(fields, strings.appleFont || 'Apple font', 'appleFont', data.fonts.appleFonts, state.appleFont);
                appendAppearanceSelect(fields, strings.serifFont || 'Serif font', 'serifFont', data.fonts.serifOptions, state.serifFont);
            } else {
                appendAppearanceSelect(fields, strings.articleTheme || 'Article theme', 'markdownTheme', data.themes, state.markdownTheme);
                appendAppearanceSelect(fields, strings.codeTheme || 'Code theme', 'codeTheme', data.codeThemes, state.codeTheme);
            }
            openPopover(popover, trigger);
        }

        function renderPublishDialog(shouldFocus) {
            var dialog = query('.easymde-immersive-workspace__publish');
            var categoriesNode = query('[data-publish-categories]');
            var titleNode = query('#easymde-immersive-publish-title');
            var summaryNode = query('[data-publish-summary]');
            var featuredSummary = query('[data-featured-summary]');
            var confirm = query('[data-publish-confirm]');

            if (!publishDraft || !publishState) {
                return;
            }
            titleNode.textContent = publishDraft.mode === 'update'
                ? (strings.updateArticle || 'Update article')
                : (strings.publishArticle || 'Publish article');
            summaryNode.textContent = publishDraft.mode === 'update'
                ? (strings.updateArticleHelp || 'Confirm these settings to update the current WordPress article.')
                : (strings.publishArticleHelp || 'Confirm these settings to publish to the current WordPress site.');
            confirm.textContent = titleNode.textContent;
            query('[data-publish-tags]').value = publishDraft.tags.join(', ');
            query('[data-publish-excerpt]').value = publishDraft.excerpt;
            query('[data-publish-preview]').checked = publishDraft.openPreview;
            featuredSummary.textContent = publishDraft.featuredImage
                ? (publishDraft.featuredImage.alt || publishDraft.featuredImage.url || String(publishDraft.featuredImage.id))
                : (strings.noFeaturedImage || 'No featured image selected');
            categoriesNode.textContent = '';
            (publishState.categoryOptions || []).forEach(function (option, index) {
                var label = doc.createElement('label');
                var input = doc.createElement('input');
                var text = doc.createElement('span');
                input.type = 'checkbox';
                input.id = 'easymde-immersive-publish-category-' + index;
                input.name = 'easymde_immersive_publish_categories[]';
                input.value = String(option.id || '');
                input.checked = publishDraft.categories.indexOf(input.value) !== -1;
                input.setAttribute('data-publish-category', '1');
                text.textContent = String(option.label || option.id || '');
                label.appendChild(input);
                label.appendChild(text);
                categoriesNode.appendChild(label);
            });
            if (!(publishState.categoryOptions || []).length) {
                categoriesNode.textContent = strings.noCategories || 'No categories are available for this post type.';
            }
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

        function closePublishDialog() {
            var dialog = query('.easymde-immersive-workspace__publish');
            if (dialog) {
                dialog.hidden = true;
            }
            query('[data-publish-backdrop]').hidden = true;
            publishDraft = null;
            publishState = null;
            publishSequence += 1;
            featuredImageTouched = false;
            query('[data-action="publish"]').focus();
        }

        function closeHistory() {
            var history = query('.easymde-immersive-workspace__history');
            if (history) {
                history.hidden = true;
            }
            query('[data-publish-backdrop]').hidden = true;
            query('[data-action="history"]').focus();
        }

        function closeActiveModal() {
            var publishDialog = query('.easymde-immersive-workspace__publish');
            var historyDialog = query('.easymde-immersive-workspace__history');

            if (historyDialog && !historyDialog.hidden) {
                closeHistory();
            } else if (publishDialog && !publishDialog.hidden) {
                closePublishDialog();
            }
        }

        function focusScope() {
            var publishDialog = query('.easymde-immersive-workspace__publish');
            var historyDialog = query('.easymde-immersive-workspace__history');

            if (publishDialog && !publishDialog.hidden) {
                return publishDialog;
            }
            if (historyDialog && !historyDialog.hidden) {
                return historyDialog;
            }
            return root;
        }

        function openHistory() {
            var history = query('.easymde-immersive-workspace__history');
            var list = query('[data-history-list]');
            var request = typeof adapter.getRevisions === 'function'
                ? adapter.getRevisions()
                : Promise.resolve([]);

            closePopovers(false);
            list.textContent = strings.loadingHistory || 'Loading revisions...';
            query('[data-publish-backdrop]').hidden = false;
            history.hidden = false;
            query('[data-action="close-history"]').focus();
            Promise.resolve(request).then(function (revisions) {
                list.textContent = '';
                if (!revisions || !revisions.length) {
                    list.textContent = strings.noRevisions || 'No revisions are available yet.';
                    return;
                }
                revisions.forEach(function (revision) {
                    var button = doc.createElement('button');
                    var titleNode = doc.createElement('strong');
                    var dateNode = doc.createElement('span');
                    button.type = 'button';
                    button.className = 'easymde-immersive-workspace__history-entry';
                    titleNode.textContent = revision.title || (strings.untitledRevision || 'Untitled revision');
                    dateNode.textContent = revision.date || '';
                    button.appendChild(titleNode);
                    button.appendChild(dateNode);
                    listen(button, 'click', function () {
                        if (typeof adapter.openRevision === 'function') {
                            adapter.openRevision(revision.id);
                        }
                    });
                    list.appendChild(button);
                });
            }).catch(function () {
                list.textContent = strings.historyFailed || 'Revision history could not be loaded.';
            });
        }

        function updatePublishDraftFromFields() {
            if (!publishDraft) {
                return;
            }
            publishDraft.tags = uniqueStrings(query('[data-publish-tags]').value, true);
            publishDraft.excerpt = query('[data-publish-excerpt]').value;
            publishDraft.openPreview = query('[data-publish-preview]').checked;
            publishDraft.categories = Array.prototype.map.call(
                root.querySelectorAll('[data-publish-category]:checked'),
                function (input) { return input.value; }
            );
        }

        function handleAction(action, trigger) {
            var popover;
            var ai;
            if (action === 'exit') {
                deactivate();
            } else if (action === 'publish') {
                openPublishDialog();
            } else if (action === 'theme' || action === 'font') {
                openAppearance(action, trigger);
            } else if (action === 'history') {
                openHistory();
            } else if (action === 'close-history') {
                closeHistory();
            } else if (action === 'cancel-publish') {
                closePublishDialog();
            } else if (action === 'confirm-publish') {
                updatePublishDraftFromFields();
                if (typeof adapter.publish === 'function') {
                    adapter.publish(createPublishDraft(publishDraft));
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
                setOutlineVisible(root.classList.contains('is-outline-hidden'));
            } else if (action === 'mobile-preview') {
                root.classList.toggle('is-mobile-preview');
            } else if (action === 'ai') {
                ai = query('.easymde-immersive-workspace__ai');
                ai.hidden = false;
                query('[data-action="ai"]').setAttribute('aria-expanded', 'true');
                ai.querySelector('input').focus();
            } else if (action === 'close-ai') {
                query('.easymde-immersive-workspace__ai').hidden = true;
                query('[data-action="ai"]').setAttribute('aria-expanded', 'false');
                query('[data-action="ai"]').focus();
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
                var aiPanel = query('.easymde-immersive-workspace__ai');
                var activePopover = root.querySelector('.easymde-immersive-workspace__popover:not([hidden])');

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
                    if (publishDialog && !publishDialog.hidden) {
                        closePublishDialog();
                    } else if (historyDialog && !historyDialog.hidden) {
                        closeHistory();
                    } else if (aiPanel && !aiPanel.hidden) {
                        aiPanel.hidden = true;
                        query('[data-action="ai"]').setAttribute('aria-expanded', 'false');
                        query('[data-action="ai"]').focus();
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
                if (
                    !activePopover
                    || activePopover.contains(event.target)
                    || (popoverTrigger && popoverTrigger.contains(event.target))
                ) {
                    return;
                }
                closePopovers(false);
            });
            listen(query('.easymde-immersive-workspace__ai form'), 'submit', function (event) {
                var input = event.currentTarget.querySelector('input');
                var message = doc.createElement('p');
                event.preventDefault();
                if (!input.value.trim()) {
                    return;
                }
                message.textContent = strings.aiDemoReply || 'Demo response only. No article data was read or sent.';
                query('.easymde-immersive-workspace__ai > div').appendChild(message);
                input.value = '';
            });
            listen(query('[data-publish-backdrop]'), 'click', closeActiveModal);
            root.querySelectorAll('[data-setting]').forEach(function (input) {
                listen(input, 'change', function () {
                    var setting = input.getAttribute('data-setting');
                    if (setting === 'outline') {
                        setOutlineVisible(input.checked);
                    } else if (setting === 'split') {
                        setView(input.checked ? 'split' : 'edit');
                    } else if (setting === 'sync') {
                        syncScroll = input.checked;
                    }
                });
            });
            bindDivider();
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
            doc.body.appendChild(root);
            doc.documentElement.classList.add(ACTIVE_CLASS);
            doc.body.classList.add(ACTIVE_CLASS);
            source = query('.easymde-immersive-workspace__source');
            title = query('.easymde-immersive-workspace__title');
            preview = query('.easymde-immersive-workspace__preview');
            main = query('.easymde-immersive-workspace__main');
            outlineNode = query('.easymde-immersive-workspace__outline');
            statsNode = query('[data-popover="statistics"]');
            cursorNode = query('.easymde-immersive-workspace__cursor');
            divider = query('.easymde-immersive-workspace__divider');
            lineNumbers = query('.easymde-immersive-workspace__line-numbers');
            source.value = typeof adapter.getMarkdown === 'function' ? adapter.getMarkdown() : '';
            title.value = typeof adapter.getTitle === 'function' ? adapter.getTitle() : '';
            if (typeof adapter.decorateWorkspace === 'function') {
                adapter.decorateWorkspace(root);
            }
            if (typeof adapter.getPublishState === 'function') {
                publishState = adapter.getPublishState();
                query('[data-publish-label]').textContent = createPublishDraft(publishState).mode === 'update'
                    ? (strings.updateArticle || 'Update article')
                    : (strings.publishArticle || 'Publish article');
                publishState = null;
            }
            bindUi();
            setSourceRatio(restoreSourceRatio());
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
            if (!root) {
                return false;
            }
            if (typeof adapter.onDeactivate === 'function') {
                adapter.onDeactivate({ root: root, source: source, preview: preview, title: title });
            }
            cancelDocumentDerivedState();
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
            outlineNode = null;
            statsNode = null;
            cursorNode = null;
            divider = null;
            lineNumbers = null;
            renderedLineCount = 0;
            popoverTrigger = null;
            doc.documentElement.classList.remove(ACTIVE_CLASS);
            doc.body.classList.remove(ACTIVE_CLASS);
            if (previousScroll && win.scrollTo) {
                win.scrollTo(previousScroll.x, previousScroll.y);
            }
            if (previousFocus && previousFocus.focus) {
                previousFocus.focus({ preventScroll: true });
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
        createPublishDraft: createPublishDraft,
        createController: createController,
        findFirstLocalImageCandidate: findFirstLocalImageCandidate,
        normalizeTitle: normalizeTitle,
        parseOutline: parseOutline
    };
}(window, document));
