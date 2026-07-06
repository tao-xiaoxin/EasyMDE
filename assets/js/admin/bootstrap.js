(function ($, window, document) {
    'use strict';

    var config = window.EasyMDEConfig || {};
    var themeOptions = config.themeOptions || {};
    var fontOptions = themeOptions.fontOptions || {};
    var editorStateTools = window.EasyMDEEditorState || {};
    var themeManager = window.EasyMDEThemeManager || {};
    var commandTools = window.EasyMDECommands || {};
    var previewClient = window.EasyMDEPreviewClient || {};
    var previewFeatureLoader = window.EasyMDEPreviewFeatureLoader || {};
    var toolbarTools = window.EasyMDEToolbar || {};
    var detectMacPlatform = editorStateTools.detectMacPlatform || detectMacPlatform;
    var applyPublishPanelDraftToNativeState = editorStateTools.applyPublishPanelDraftToNativeState || function (nativeState, draft) {
        nativeState = nativeState || {};
        draft = draft || {};

        return {
            categories: draft.categories || [],
            excerpt: draft.excerpt || '',
            featuredImageId: draft.featuredImageMode === 'clear'
                ? 0
                : (draft.featuredImageCandidate && draft.featuredImageCandidate.id ? draft.featuredImageCandidate.id : (nativeState.featuredImageId || 0)),
            postStatus: nativeState.postStatus || '',
            tags: draft.tags || [],
            tagString: (draft.tags || []).join(', ')
        };
    };
    var createPublishPanelDraft = editorStateTools.createPublishPanelDraft || function (options) {
        options = options || {};

        return {
            categories: options.categories || [],
            excerpt: options.excerpt || '',
            featuredImageCandidate: options.featuredImageCandidate || null,
            featuredImageMode: options.featuredImageMode || (options.featuredImageCandidate ? 'candidate' : 'keep'),
            mode: options.postStatus === 'publish' ? 'update' : 'publish',
            publishAfterPreview: !!options.publishAfterPreview,
            tags: options.tags || []
        };
    };
    var extractOutlineHeadings = editorStateTools.extractOutlineHeadings || function () {
        return [];
    };
    var calculateWordStatistics = editorStateTools.calculateWordStatistics || function (markdown) {
        var normalized = String(markdown || '').replace(/\r\n?/g, '\n');

        return {
            normalizedMarkdown: normalized,
            lineCount: '' === normalized ? 0 : normalized.split('\n').length,
            westernWords: 0,
            cjkCharacters: 0,
            totalCharacters: 0,
            readingMinutes: 0
        };
    };
    var findFirstLocalImageCandidate = editorStateTools.findFirstLocalImageCandidate || function () {
        return null;
    };
    var normalizeRenderState = themeManager.normalizeRenderState || normalizeRenderState;
    var findById = editorStateTools.findById || findById;
    var normalizeCategoryIds = editorStateTools.normalizeCategoryIds || function (values) {
        return Array.isArray(values) ? values : [];
    };
    var normalizeTagList = editorStateTools.normalizeTagList || function (values) {
        return Array.isArray(values) ? values : [];
    };
    var serializeTagList = editorStateTools.serializeTagList || function (tags) {
        return Array.isArray(tags) ? tags.join(', ') : '';
    };
    var escapeHtml = editorStateTools.escapeHtml || escapeHtml;
    var focusWithoutScrolling = editorStateTools.focusWithoutScrolling || focusWithoutScrolling;
    var restoreScrollPosition = editorStateTools.restoreScrollPosition || restoreScrollPosition;
    var replaceClassPrefix = editorStateTools.replaceClassPrefix || replaceClassPrefix;
    var buildCommandMap = commandTools.buildCommandMap || buildCommandMap;
    var getCommandLabel = commandTools.getCommandLabel || getCommandLabel;
    var createWechatIcon = toolbarTools.createWechatIcon || createWechatIcon;
    var createMenuAnchor = toolbarTools.createMenuAnchor || createMenuAnchor;
    var createSelectControl = toolbarTools.createSelectControl || createSelectControl;
    var renderState = normalizeRenderState(themeOptions.state || {});
    var customCssLibrary = themeOptions.customCss || [];
    var previewTimer = null;
    var previewRevision = 0;
    var previewAbortController = null;
    var imagePasteLoadPromise = null;
    var mediaPickerLoadPromise = null;
    var wechatExporterLoadPromise = null;
    var activePreviewFeatures = normalizePreviewFeatures(config.features || {});
    var draftTimer = null;
    var syncLock = false;
    var flashTimer = null;
    var commandMap = null;
    var commandList = null;
    var commandSurfaceCache = {};
    var commandGroupCache = {};
    var isMac = null;
    var openPopovers = [];
    var fontControls = null;
    var WORKSPACE_DEFAULT_SOURCE_RATIO = 0.5;
    var WORKSPACE_DIVIDER_SIZE = 18;
    var WORKSPACE_PANE_MIN_WIDTH = 320;
    var WORKSPACE_KEYBOARD_STEP = 48;

    function defaultGetCommand(id) {
        return getCommandMap()[id] || null;
    }

    function defaultGetShortcutForCommand(commandId) {
        var shortcuts = config.shortcuts || {};
        var shortcut = shortcuts[commandId] || {};

        return getIsMac() ? (shortcut.mac || '') : (shortcut.win || '');
    }

    var getCommand = commandTools.getCommand ? function (id) {
        return commandTools.getCommand(getCommandMap(), id);
    } : defaultGetCommand;
    var getShortcutForCommand = commandTools.getShortcutForCommand ? function (commandId) {
        return commandTools.getShortcutForCommand(config.shortcuts || {}, commandId, getIsMac());
    } : defaultGetShortcutForCommand;
    var selectedCustomCssItem = themeManager.selectedCustomCssItem ? function () {
        return themeManager.selectedCustomCssItem(renderState, customCssLibrary, findById);
    } : selectedCustomCssItem;
    var selectedCustomCss = themeManager.selectedCustomCss ? function () {
        return themeManager.selectedCustomCss(renderState, customCssLibrary, findById);
    } : selectedCustomCss;
    var previewFallback = previewClient.createFallback ? function (markdown) {
        return previewClient.createFallback(markdown, getString('previewEmpty'), escapeHtml);
    } : previewFallback;
    var capturePreviewScroll = previewClient.captureScroll || capturePreviewScroll;
    var applyTextChange = commandTools.applyTextChange ? function (textarea, value, selectionStart, selectionEnd) {
        return commandTools.applyTextChange(textarea, value, selectionStart, selectionEnd, getCommandServices());
    } : applyTextChange;
    var insertAround = commandTools.insertAround ? function (textarea, prefix, suffix, placeholder) {
        return commandTools.insertAround(textarea, prefix, suffix, placeholder, getCommandServices());
    } : insertAround;
    var applyLinePrefix = commandTools.applyLinePrefix ? function (textarea, prefix) {
        return commandTools.applyLinePrefix(textarea, prefix, getCommandServices());
    } : applyLinePrefix;
    var applyOrderedList = commandTools.applyOrderedList ? function (textarea) {
        return commandTools.applyOrderedList(textarea, getCommandServices());
    } : applyOrderedList;
    var setHeadingLevel = commandTools.setHeadingLevel ? function (textarea, level) {
        return commandTools.setHeadingLevel(textarea, level, getCommandServices());
    } : setHeadingLevel;
    var insertBlock = commandTools.insertBlock ? function (textarea, prefix, suffix, placeholder) {
        return commandTools.insertBlock(textarea, prefix, suffix, placeholder, getCommandServices());
    } : insertBlock;

    function getString(key) {
        return config.strings && config.strings[key] ? config.strings[key] : '';
    }

    function normalizePreviewFeatures(features) {
        if (previewFeatureLoader.normalizeFeatures) {
            return previewFeatureLoader.normalizeFeatures(features || {});
        }

        features = features || {};

        return {
            localDrafts: features.localDrafts !== false,
            codeBlocks: !!features.codeBlocks,
            syntaxHighlight: !!features.syntaxHighlight,
            mermaid: !!features.mermaid,
            math: !!features.math,
            toc: !!features.toc,
            wechatCopy: features.wechatCopy !== false
        };
    }

    function getCommandServices() {
        return {
            $: $,
            focusWithoutScrolling: focusWithoutScrolling,
            restoreScrollPosition: restoreScrollPosition
        };
    }

    function detectMacPlatform() {
        var platform = window.navigator && (window.navigator.userAgentData && window.navigator.userAgentData.platform
            ? window.navigator.userAgentData.platform
            : window.navigator.platform);

        return typeof platform === 'string' && platform.toLowerCase().indexOf('mac') !== -1;
    }

    function buildCommandMap(commands) {
        var map = {};

        (commands || []).forEach(function (command) {
            if (command && command.id) {
                map[String(command.id)] = command;
            }
        });

        return map;
    }

    function getCommandMap() {
        if (!commandMap) {
            commandMap = buildCommandMap(config.commands || []);
        }

        return commandMap;
    }

    function getCommandList() {
        var map;

        if (!commandList) {
            map = getCommandMap();
            commandList = Object.keys(map).map(function (id) {
                return map[id];
            });
        }

        return commandList;
    }

    function getIsMac() {
        if (isMac === null) {
            isMac = detectMacPlatform();
        }

        return isMac;
    }

    function normalizeRenderState(state) {
        state = state || {};

        return {
            markdownTheme: state.markdownTheme || 'default',
            codeTheme: state.codeTheme || 'atom-one-dark',
            codeMacStyle: state.codeMacStyle === undefined ? true : !!state.codeMacStyle,
            customCssId: state.customCssId || '',
            customCss: state.customCss || '',
            scopedCustomCss: state.scopedCustomCss || '',
            customFont: state.customFont || 'optima',
            windowsFont: state.windowsFont || 'microsoft-yahei',
            appleFont: state.appleFont || 'pingfang-sc-light',
            serifFont: state.serifFont || 'yes'
        };
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

    function selectedCustomCssItem() {
        if (renderState.markdownTheme !== 'custom' || !renderState.customCssId) {
            return null;
        }

        return findById(customCssLibrary, renderState.customCssId);
    }

    function selectedCustomCss() {
        var item = selectedCustomCssItem();

        if (item) {
            return item.scopedCss || '';
        }

        return renderState.scopedCustomCss || '';
    }

    function getSurfaceCommands(surface) {
        if (!commandSurfaceCache[surface]) {
            commandSurfaceCache[surface] = getCommandList().filter(function (command) {
                return command.surface === surface;
            });
        }

        return commandSurfaceCache[surface];
    }

    function getGroupCommands(surface, group) {
        var key = surface + ':' + group;

        if (!commandGroupCache[key]) {
            commandGroupCache[key] = getSurfaceCommands(surface).filter(function (command) {
                return command.group === group;
            });
        }

        return commandGroupCache[key];
    }

    function getCommandLabel(command) {
        return command && command.label ? command.label : (command ? command.id : '');
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

    function applyTextChange(textarea, value, selectionStart, selectionEnd) {
        var scrollTop = textarea.scrollTop;
        var scrollLeft = textarea.scrollLeft;
        var windowScrollX = window.pageXOffset;
        var windowScrollY = window.pageYOffset;

        textarea.value = value;
        focusWithoutScrolling(textarea);

        if (typeof selectionStart === 'number' && typeof selectionEnd === 'number') {
            textarea.selectionStart = selectionStart;
            textarea.selectionEnd = selectionEnd;
        }

        restoreScrollPosition(textarea, scrollTop, scrollLeft);
        window.scrollTo(windowScrollX, windowScrollY);
        $(textarea).trigger('input');
        window.setTimeout(function () {
            restoreScrollPosition(textarea, scrollTop, scrollLeft);
            window.scrollTo(windowScrollX, windowScrollY);
        }, 0);
    }

    function insertAround(textarea, prefix, suffix, placeholder) {
        var start = textarea.selectionStart;
        var end = textarea.selectionEnd;
        var value = textarea.value;
        var selected = value.slice(start, end) || (placeholder || '');
        var replacement = prefix + selected + suffix;

        applyTextChange(
            textarea,
            value.slice(0, start) + replacement + value.slice(end),
            start + prefix.length,
            start + prefix.length + selected.length
        );
    }

    function transformSelectedLines(textarea, transform) {
        var start = textarea.selectionStart;
        var end = textarea.selectionEnd;
        var value = textarea.value;
        var lineStart = value.lastIndexOf('\n', start - 1) + 1;
        var lineEnd = value.indexOf('\n', end);

        if (lineEnd === -1) {
            lineEnd = value.length;
        }

        var block = value.slice(lineStart, lineEnd);
        var lines = block.split('\n');
        var updatedLines = transform(lines);
        var replacement = updatedLines.join('\n');

        applyTextChange(
            textarea,
            value.slice(0, lineStart) + replacement + value.slice(lineEnd),
            lineStart,
            lineStart + replacement.length
        );
    }

    function stripLineMarkup(line) {
        return String(line)
            .replace(/^\s{0,3}#{1,6}\s+/, '')
            .replace(/^\s{0,3}>\s?/, '')
            .replace(/^\s{0,3}(?:[-+*]\s+|\d+\.\s+)/, '');
    }

    function applyLinePrefix(textarea, prefix) {
        transformSelectedLines(textarea, function (lines) {
            return lines.map(function (line) {
                if (!line) {
                    return prefix.trim();
                }

                return prefix + stripLineMarkup(line);
            });
        });
    }

    function applyOrderedList(textarea) {
        transformSelectedLines(textarea, function (lines) {
            var index = 1;

            return lines.map(function (line) {
                if (!line.trim()) {
                    return '';
                }

                var updated = index + '. ' + stripLineMarkup(line);
                index += 1;

                return updated;
            });
        });
    }

    function setHeadingLevel(textarea, level) {
        transformSelectedLines(textarea, function (lines) {
            return lines.map(function (line) {
                var content = stripLineMarkup(line).trim();

                if (!content) {
                    return '';
                }

                if (!level) {
                    return content;
                }

                return new Array(level + 1).join('#') + ' ' + content;
            });
        });
    }

    function insertBlock(textarea, prefix, suffix, placeholder) {
        var start = textarea.selectionStart;
        var end = textarea.selectionEnd;
        var value = textarea.value;
        var selected = value.slice(start, end);
        var content = selected || (placeholder || '');
        var needsLeadingNewline = start > 0 && value.charAt(start - 1) !== '\n';
        var needsTrailingNewline = end < value.length && value.charAt(end) !== '\n';
        var blockPrefix = (needsLeadingNewline ? '\n' : '') + prefix;
        var blockSuffix = suffix + (needsTrailingNewline ? '\n' : '');
        var replacement = blockPrefix + content + blockSuffix;

        applyTextChange(
            textarea,
            value.slice(0, start) + replacement + value.slice(end),
            start + blockPrefix.length,
            start + blockPrefix.length + content.length
        );
    }

    function triggerSavePost() {
        var $button = $('#save-post');

        if ($button.length && !$button.prop('disabled')) {
            $button.trigger('click');
            return;
        }

        $button = $('#publish');
        if ($button.length && !$button.prop('disabled')) {
            $button.trigger('click');
            return;
        }

        $('#post').trigger('submit');
    }

    var wechatIconPaths = [
        'M38.7,15.3c-3.7-4.9-10.2-6.2-16.1-4.1c0.2,0.1,0.4,0.1,0.6,0.2c8.7,2.9,13.3,12.3,10.4,21 c-0.8,2.3-2,4.3-3.5,6c1.9-0.5,3.8-1.3,5.4-2.5C42.1,30.8,43.4,21.4,38.7,15.3z',
        'M17,10.4L17,10.4C17,10.4,17,10.4,17,10.4c0.4-0.3,0.7-0.5,1.1-0.8c0,0,0,0,0.1,0c0.4-0.2,0.8-0.4,1.1-0.7 c0,0,0.1,0,0.1-0.1c0.8-0.4,1.6-0.7,2.4-1c0.1,0,0.1,0,0.2-0.1c0.4-0.1,0.8-0.3,1.2-0.4c0,0,0.1,0,0.1,0c0.4-0.1,0.8-0.2,1.2-0.2 c0.1,0,0.1,0,0.2,0C25.3,7,25.7,7,26.1,7c0.1,0,0.2,0,0.3,0c0.4,0,0.9-0.1,1.3-0.1c0.5,0,1,0,1.5,0.1c0.1,0,0.1,0,0.2,0 c0.5,0,0.9,0.1,1.4,0.2c0.1,0,0.2,0,0.2,0c0.5,0.1,0.9,0.2,1.3,0.3c0.1,0,0.1,0,0.2,0.1C33,7.7,33.5,7.8,33.9,8 c-0.2-0.4-0.4-0.7-0.4-0.7C30.6,2.7,25.8,0,20.6,0c-3.1,0-7.9,1.1-11.5,5.4c-2.4,2.9-3.2,6.3-2.7,9.7c0.3,2.3,1.6,5.4,3.5,7.3 C10.6,17.5,13.2,13.2,17,10.4z',
        'M20.6,30.9c-1.3,0-2.6-0.2-3.8-0.4c-0.1,0-0.3,0-0.5,0c-0.4,0-0.7,0.1-1,0.3l-4,2.6 c-0.1,0.1-0.2,0.1-0.4,0.1c-0.3,0-0.6-0.3-0.7-0.6c0-0.2,0-0.3,0.1-0.5c0-0.1,0.4-2,0.7-3.2c0-0.1,0.1-0.3,0-0.4 c0-0.4-0.2-0.8-0.6-1c-4.3-2.9-7.2-7.5-7.8-12.2c-1.1,1.7-1.6,3-2.2,5c-2.1,7.3,2.5,16,9.9,18.4c8.6,2.8,16.7-0.3,19.5-7.6 c0.3-0.9,0.7-2.4,0.8-3.6C27.7,29.9,24.6,30.9,20.6,30.9z'
    ];

    function createWechatIcon() {
        var paths = wechatIconPaths.map(function (path) {
            return '<path d="' + path + '"></path>';
        }).join('');

        return $(
            '<span class="easymde-wechat-glyph" aria-hidden="true">' +
                '<svg viewBox="0 0 40 40" focusable="false" aria-hidden="true">' +
                    paths +
                '</svg>' +
            '</span>'
        );
    }

    function createIconContent(command, options) {
        var $fragment = $(document.createDocumentFragment());
        var label = getCommandLabel(command);
        var icon = command.icon || '';
        var compact = options && options.compact;
        var iconTextMap = {
            mediacode: '</>',
            'media-code': '</>',
            heading: 'H'
        };
        var $icon = null;

        if (icon === 'copy') {
            $icon = createWechatIcon();
        } else if (iconTextMap[icon]) {
            $icon = $('<span class="easymde-toolbar-text-icon" aria-hidden="true"></span>').text(iconTextMap[icon]);
        } else {
            $icon = $('<span class="dashicons" aria-hidden="true"></span>').addClass('dashicons-' + icon);
        }

        $fragment.append($icon);

        if (!compact) {
            $fragment.append($('<span class="easymde-toolbar-label"></span>').text(label));
        }

        return $fragment;
    }

    function createCommandButton(command, options) {
        var $button = $('<button type="button" class="easymde-toolbar-button"></button>');
        var shortcut = getShortcutForCommand(command.id);
        var label = getCommandLabel(command);
        var compact = !options || options.compact !== false;

        if (options && options.className) {
            $button.addClass(options.className);
        }

        $button.attr('data-easymde-command', command.id);
        $button.attr('aria-label', label);
        $button.attr('title', shortcut ? label + ' (' + shortcut + ')' : label);
        $button.toggleClass('easymde-toolbar-button-compact', compact);
        $button.append(createIconContent(command, { compact: compact }));

        $button.on('mousedown', function (event) {
            event.preventDefault();
        });

        $button.on('click', function () {
            executeCommand(command.id, options && options.context ? options.context : {});
        });

        return $button;
    }

    function registerPopover($button, $panel, options) {
        openPopovers.push({
            button: $button,
            panel: $panel
        });

        $button.attr('aria-expanded', 'false');

        $button.on('mousedown', function (event) {
            event.preventDefault();
        });

        $button.on('click', function (event) {
            event.preventDefault();
            event.stopPropagation();

            var isOpen = !$panel.prop('hidden');
            closePopovers();

            if (!isOpen && options && typeof options.beforeOpen === 'function') {
                options.beforeOpen();
            }

            $panel.prop('hidden', isOpen);
            $button.toggleClass('is-active', !isOpen);
            $button.attr('aria-expanded', isOpen ? 'false' : 'true');
        });

        $panel.on('click', function (event) {
            event.stopPropagation();
        });
    }

    function closePopovers() {
        openPopovers.forEach(function (popover) {
            popover.panel.prop('hidden', true);
            popover.button.removeClass('is-active');
            popover.button.attr('aria-expanded', 'false');
        });
    }

    function createMenuAnchor(extraClass) {
        return $('<div class="easymde-toolbar-popover-anchor"></div>').addClass(extraClass || '');
    }

    function createUtilityButton(label, iconClass, className) {
        var $button = $('<button type="button" class="easymde-toolbar-button easymde-toolbar-button-compact"></button>');

        if (className) {
            $button.addClass(className);
        }

        $button.attr('aria-label', label);
        $button.attr('title', label);
        $button.append(
            $('<span class="dashicons" aria-hidden="true"></span>').addClass(iconClass)
        );

        return $button;
    }

    function createHeadingMenu($container, textarea) {
        var headingCommands = getSurfaceCommands('heading-menu');

        if (!headingCommands.length) {
            return;
        }

        var $anchor = createMenuAnchor('easymde-toolbar-popover-headings');
        var $button = $('<button type="button" class="easymde-toolbar-button easymde-toolbar-button-menu easymde-toolbar-button-compact"></button>');
        var $panel = $('<div class="easymde-toolbar-popover" hidden></div>');
        var panelReady = false;

        $button.attr('title', getString('headings'));
        $button.attr('aria-label', getString('headings'));
        $button.append(
            $('<span class="easymde-toolbar-text-icon" aria-hidden="true"></span>').text('H'),
            $('<span class="dashicons dashicons-arrow-down-alt2" aria-hidden="true"></span>')
        );

        function populatePanel() {
            if (panelReady) {
                return;
            }

            panelReady = true;
            headingCommands.forEach(function (command) {
                var $item = $('<button type="button" class="easymde-popover-item"></button>');
                var shortcut = getShortcutForCommand(command.id);

                $item.append(
                    $('<span class="easymde-popover-item-label"></span>').text(getCommandLabel(command)),
                    $('<span class="easymde-popover-item-shortcut"></span>').text(shortcut)
                );

                $item.on('mousedown', function (event) {
                    event.preventDefault();
                });

                $item.on('click', function () {
                    closePopovers();
                    executeCommand(command.id, { textarea: textarea });
                });

                $panel.append($item);
            });
        }

        registerPopover($button, $panel, { beforeOpen: populatePanel });
        $anchor.append($button, $panel);
        $container.append($anchor);
    }

    function createSelectControl(label, className) {
        var $control = $('<label class="easymde-toolbar-control"></label>');
        var $label = $('<span class="easymde-toolbar-control-label"></span>').text(label);
        var $select = $('<select></select>').addClass(className);

        $control.append($label, $select);

        return {
            root: $control,
            select: $select
        };
    }

    function renderThemeSelect($select) {
        var selected = renderState.markdownTheme === 'custom' && renderState.customCssId
            ? 'custom:' + renderState.customCssId
            : 'theme:' + renderState.markdownTheme;

        $select.empty();

        (themeOptions.markdownThemes || []).forEach(function (theme) {
            $select.append($('<option></option>').attr('value', 'theme:' + theme.id).text(theme.label || theme.id));
        });

        if (customCssLibrary.length) {
            var $group = $('<optgroup></optgroup>').attr('label', getString('namedCustomCss'));

            customCssLibrary.forEach(function (item) {
                $group.append($('<option></option>').attr('value', 'custom:' + item.id).text(item.name));
            });

            $select.append($group);
        }

        $select.val(selected);

        if (!$select.val()) {
            $select.val('theme:default');
        }
    }

    function renderCodeThemeSelect($select) {
        $select.empty();

        (themeOptions.codeThemes || []).forEach(function (theme) {
            $select.append($('<option></option>').attr('value', theme.id).text(theme.label || theme.id));
        });

        $select.val(renderState.codeTheme || 'atom-one-dark');
    }

    function getFontGroup(group) {
        return fontOptions && fontOptions[group] ? fontOptions[group] : [];
    }

    function getFontOption(group, id) {
        return findById(getFontGroup(group), id);
    }

    function getMarkdownTheme(id) {
        return findById(themeOptions.markdownThemes || [], id);
    }

    function renderFontSelect($select, group, selected) {
        $select.empty();

        getFontGroup(group).forEach(function (font) {
            $select.append($('<option></option>').attr('value', font.id).text(font.label || font.id));
        });

        $select.val(selected);

        if (!$select.val() && getFontGroup(group).length) {
            $select.val(getFontGroup(group)[0].id);
        }
    }

    function appendFontStackPart(parts, seen, value) {
        String(value || '').split(',').forEach(function (part) {
            var font = part.trim();
            var key = font.toLowerCase();

            if (font && !seen[key]) {
                seen[key] = true;
                parts.push(font);
            }
        });
    }

    function buildFontStack() {
        var parts = [];
        var seen = {};
        var groups = [
            ['customFonts', renderState.customFont],
            ['windowsFonts', renderState.windowsFont],
            ['appleFonts', renderState.appleFont],
            ['serifOptions', renderState.serifFont]
        ];

        groups.forEach(function (entry) {
            var option = getFontOption(entry[0], entry[1]);

            if (option && option.fontFamily) {
                appendFontStackPart(parts, seen, option.fontFamily);
            }
        });

        return parts.join(', ');
    }

    function applyThemeFontDefaults(themeId) {
        var theme = getMarkdownTheme(themeId);
        var defaults = theme && theme.fontDefaults ? theme.fontDefaults : null;

        if (!defaults) {
            return;
        }

        renderState.customFont = defaults.customFont || renderState.customFont;
        renderState.windowsFont = defaults.windowsFont || renderState.windowsFont;
        renderState.appleFont = defaults.appleFont || renderState.appleFont;
        renderState.serifFont = defaults.serifFont || renderState.serifFont;
    }

    function syncFontControls() {
        if (!fontControls) {
            return;
        }

        fontControls.custom.val(renderState.customFont || 'optima');
        fontControls.windows.val(renderState.windowsFont || 'microsoft-yahei');
        fontControls.apple.val(renderState.appleFont || 'pingfang-sc-light');
        fontControls.serif.val(renderState.serifFont || 'yes');
    }

    function syncThemeFields() {
        $('#easymde-markdown-theme-field').val(renderState.markdownTheme || 'default');
        $('#easymde-code-theme-field').val(renderState.codeTheme || 'atom-one-dark');
        $('#easymde-code-mac-style-field').val(renderState.codeMacStyle ? '1' : '0');
        $('#easymde-custom-css-id-field').val(renderState.markdownTheme === 'custom' ? renderState.customCssId : '');
        $('#easymde-custom-font-field').val(renderState.customFont || 'optima');
        $('#easymde-windows-font-field').val(renderState.windowsFont || 'microsoft-yahei');
        $('#easymde-apple-font-field').val(renderState.appleFont || 'pingfang-sc-light');
        $('#easymde-serif-font-field').val(renderState.serifFont || 'yes');
    }

    function replaceClassPrefix(element, prefix, className) {
        var classes = (element.className || '').split(/\s+/).filter(function (name) {
            return name && name.indexOf(prefix) !== 0;
        });

        classes.push(className);
        element.className = classes.join(' ');
    }

    function setCustomCssStyle(css) {
        var id = 'easymde-custom-css-preview';
        var style = document.getElementById(id);

        if (!style) {
            style = document.createElement('style');
            style.id = id;
            document.head.appendChild(style);
        }

        style.textContent = css || '';
    }

    function applyCodeThemeLink(enabled) {
        var link = document.getElementById('easymde-highlight-theme-css');

        if (!enabled) {
            if (link && link.parentNode) {
                link.parentNode.removeChild(link);
            }
        }
    }

    function applyArticleThemeLink() {
        themeManager.applyArticleThemeLink(themeOptions, renderState, findById, document);
    }

    function applyRenderState($preview, features, options) {
        var preview = $preview[0];
        var markdownClass = renderState.markdownTheme === 'custom'
            ? 'easymde-markdown-theme-custom'
            : 'easymde-markdown-theme-' + renderState.markdownTheme;
        var fontStack = buildFontStack();

        options = options || {};
        features = normalizePreviewFeatures(features || activePreviewFeatures);

        if (!preview) {
            return;
        }

        replaceClassPrefix(preview, 'easymde-markdown-theme-', markdownClass);
        replaceClassPrefix(preview, 'easymde-code-theme-', 'easymde-code-theme-' + renderState.codeTheme);
        $preview.addClass('easymde-rendered-content');
        $preview.toggleClass('easymde-code-mac', !!renderState.codeMacStyle);
        $preview.toggleClass('easymde-custom-css-active', renderState.markdownTheme === 'custom');
        $preview.toggleClass('easymde-font-overrides', !!fontStack);

        if (fontStack) {
            preview.style.setProperty('--easymde-content-font-family', fontStack);
        } else {
            preview.style.removeProperty('--easymde-content-font-family');
        }

        if (options.syncFields !== false) {
            syncThemeFields();
        }
        syncFontControls();
        applyArticleThemeLink();
        applyCodeThemeLink(features.syntaxHighlight);
        setCustomCssStyle(renderState.markdownTheme === 'custom' ? selectedCustomCss() : '');
    }

    function fillCustomPanel($panel) {
        var item = selectedCustomCssItem();

        $panel.find('.easymde-custom-css-name').val(item ? item.name : '');
        $panel.find('.easymde-custom-css-code').val(item ? item.css : '');
    }

    function createAppearanceMenu($container, $root, $preview, refreshPreview) {
        var $anchor = createMenuAnchor('easymde-toolbar-popover-appearance');
        var $button = $('<button type="button" class="easymde-toolbar-button easymde-toolbar-button-menu easymde-toolbar-button-compact"></button>');
        var $panel = $('<div class="easymde-toolbar-popover easymde-toolbar-popover-appearance-panel" hidden></div>');
        var panelReady = false;

        $button.attr('title', getString('appearance'));
        $button.attr('aria-label', getString('appearance'));
        $button.append(
            $('<span class="dashicons dashicons-admin-customizer" aria-hidden="true"></span>'),
            $('<span class="dashicons dashicons-arrow-down-alt2" aria-hidden="true"></span>')
        );

        function populatePanel() {
            var themeControl;
            var codeControl;
            var $macLabel;
            var $macToggle;
            var $customToggle;
            var $customPanel;
            var $name;
            var $code;
            var $save;
            var $status;

            if (panelReady) {
                return;
            }

            panelReady = true;
            themeControl = createSelectControl(getString('articleTheme'), 'easymde-theme-select');
            codeControl = createSelectControl(getString('codeTheme'), 'easymde-code-theme-select');
            $macLabel = $('<label class="easymde-toolbar-check"></label>');
            $macToggle = $('<input type="checkbox">').prop('checked', !!renderState.codeMacStyle);
            $customToggle = $('<button type="button" class="button button-secondary easymde-custom-css-toggle"></button>').text(getString('customCss'));
            $customPanel = $('<div class="easymde-custom-css-panel" hidden></div>');
            $name = $('<input type="text" class="regular-text easymde-custom-css-name">').attr('placeholder', getString('cssName'));
            $code = $('<textarea class="easymde-custom-css-code" spellcheck="false"></textarea>');
            $save = $('<button type="button" class="button button-primary"></button>').text(getString('saveCss'));
            $status = $('<span class="easymde-custom-css-status" aria-live="polite"></span>');

            renderThemeSelect(themeControl.select);
            renderCodeThemeSelect(codeControl.select);

            $macLabel.append($macToggle, $('<span></span>').text(getString('macCodeFrame')));
            $customPanel.append(
                $('<div class="easymde-custom-css-row"></div>').append($name, $save, $status),
                $code
            );
            fillCustomPanel($customPanel);

            $panel.append(
                themeControl.root,
                codeControl.root,
                $macLabel,
                $('<div class="easymde-custom-css-toggle-row"></div>').append($customToggle),
                $customPanel
            );

            themeControl.select.on('change', function () {
                var value = String($(this).val() || 'theme:default');
                var parts = value.split(':');
                var item = null;

                if (parts[0] === 'custom') {
                    item = findById(customCssLibrary, parts[1]);
                    if (item) {
                        renderState.markdownTheme = 'custom';
                        renderState.customCssId = item.id;
                        renderState.customCss = item.css || '';
                        renderState.scopedCustomCss = item.scopedCss || '';
                        fillCustomPanel($customPanel);
                    }
                } else {
                    renderState.markdownTheme = parts[1] || 'default';
                    renderState.customCssId = '';
                    renderState.customCss = '';
                    renderState.scopedCustomCss = '';
                    applyThemeFontDefaults(renderState.markdownTheme);
                }

                applyRenderState($preview);
                refreshPreview();
            });

            codeControl.select.on('change', function () {
                renderState.codeTheme = String($(this).val() || 'atom-one-dark');
                applyRenderState($preview);
                refreshPreview();
            });

            $macToggle.on('change', function () {
                renderState.codeMacStyle = !!this.checked;
                applyRenderState($preview);
                refreshPreview();
            });

            $customToggle.on('click', function () {
                $customPanel.prop('hidden', !$customPanel.prop('hidden'));
                fillCustomPanel($customPanel);
            });

            $save.on('click', function () {
                if (!window.wp || !window.wp.apiFetch || !config.customCssUrl) {
                    $status.text(getString('cssSaveFailed'));
                    return;
                }

                $status.text('');
                window.wp.apiFetch({
                    url: config.customCssUrl,
                    method: 'POST',
                    headers: {
                        'X-WP-Nonce': config.nonce
                    },
                    data: {
                        id: renderState.markdownTheme === 'custom' ? renderState.customCssId : '',
                        name: $name.val(),
                        css: $code.val()
                    }
                }).then(function (response) {
                    customCssLibrary = response.customCss || customCssLibrary;
                    renderState.markdownTheme = 'custom';
                    renderState.customCssId = response.item.id;
                    renderState.customCss = response.item.css || '';
                    renderState.scopedCustomCss = response.item.scopedCss || '';
                    themeOptions.state = renderState;

                    renderThemeSelect(themeControl.select);
                    themeControl.select.val('custom:' + response.item.id);
                    applyRenderState($preview);
                    refreshPreview();
                    $status.text(getString('cssSaved'));
                }).catch(function () {
                    $status.text(getString('cssSaveFailed'));
                });
            });
        }

        registerPopover($button, $panel, { beforeOpen: populatePanel });
        $anchor.append($button, $panel);
        $container.append($anchor);
    }

    function createFontMenu($container, $preview) {
        var $anchor = createMenuAnchor('easymde-toolbar-popover-font');
        var $button = $('<button type="button" class="easymde-toolbar-button easymde-toolbar-button-menu easymde-toolbar-button-compact"></button>');
        var $panel = $('<div class="easymde-toolbar-popover easymde-toolbar-popover-font-panel" hidden></div>');
        var panelReady = false;

        if (!getFontGroup('customFonts').length) {
            return;
        }

        $button.attr('title', getString('font'));
        $button.attr('aria-label', getString('font'));
        $button.append(
            $('<span class="easymde-toolbar-text-icon easymde-font-glyph" aria-hidden="true"></span>').text('A'),
            $('<span class="dashicons dashicons-arrow-down-alt2" aria-hidden="true"></span>')
        );

        function populatePanel() {
            var customControl;
            var windowsControl;
            var appleControl;
            var serifControl;
            var controls;

            if (panelReady) {
                return;
            }

            panelReady = true;
            customControl = createSelectControl(getString('customFont'), 'easymde-custom-font-select');
            windowsControl = createSelectControl(getString('windowsFont'), 'easymde-windows-font-select');
            appleControl = createSelectControl(getString('appleFont'), 'easymde-apple-font-select');
            serifControl = createSelectControl(getString('serifFont'), 'easymde-serif-font-select');
            fontControls = {
                custom: customControl.select,
                windows: windowsControl.select,
                apple: appleControl.select,
                serif: serifControl.select
            };
            controls = [
                [customControl, 'customFonts', 'customFont'],
                [windowsControl, 'windowsFonts', 'windowsFont'],
                [appleControl, 'appleFonts', 'appleFont'],
                [serifControl, 'serifOptions', 'serifFont']
            ];

            controls.forEach(function (entry) {
                var control = entry[0];
                var group = entry[1];
                var stateKey = entry[2];

                renderFontSelect(control.select, group, renderState[stateKey]);

                control.select.on('change', function () {
                    renderState[stateKey] = String($(this).val() || '');
                    applyRenderState($preview);
                });

                $panel.append(control.root);
            });

            $panel.append(
                $('<p class="easymde-toolbar-help"></p>').text(getString('fontStackHelp'))
            );
        }

        registerPopover($button, $panel, { beforeOpen: populatePanel });
        $anchor.append($button, $panel);
        $container.append($anchor);
    }

    function createFlash($toolbar) {
        var $flash = $('<div class="easymde-editor-flash" hidden aria-live="polite"></div>');

        $toolbar.after($flash);

        return $flash;
    }

    function showFlash($flash, type, message) {
        window.clearTimeout(flashTimer);
        $flash
            .removeClass('is-success is-error is-info')
            .addClass('is-' + type)
            .text(message)
            .prop('hidden', false);

        flashTimer = window.setTimeout(function () {
            $flash.prop('hidden', true).text('');
        }, 3200);
    }

    function workspaceLayoutKey(storage) {
        storage = storage || {};

        if (storage.layoutKey) {
            return String(storage.layoutKey);
        }

        if (storage.siteKey && storage.userId !== undefined) {
            return 'easymde:layout:' + storage.siteKey + ':' + storage.userId;
        }

        return '';
    }

    function readStoredWorkspaceRatio(storage) {
        var key = workspaceLayoutKey(storage);
        var rawValue;
        var parsed;

        if (!key || !window.localStorage || typeof window.localStorage.getItem !== 'function') {
            return null;
        }

        try {
            rawValue = window.localStorage.getItem(key);
        } catch (error) {
            return null;
        }

        if (rawValue === null || rawValue === undefined || rawValue === '') {
            return null;
        }

        parsed = parseFloat(rawValue);

        return isFinite(parsed) ? parsed : null;
    }

    function writeStoredWorkspaceRatio(storage, ratio) {
        var key = workspaceLayoutKey(storage);

        if (!key || !window.localStorage || typeof window.localStorage.setItem !== 'function') {
            return;
        }

        try {
            window.localStorage.setItem(key, String(ratio));
        } catch (error) {
            return;
        }
    }

    function workspaceWidth(context) {
        var workspace = context && context.workspaceNode ? context.workspaceNode : null;
        var rect = workspace && typeof workspace.getBoundingClientRect === 'function'
            ? workspace.getBoundingClientRect()
            : null;

        if (rect && rect.width) {
            return rect.width;
        }

        if (workspace && workspace.clientWidth) {
            return workspace.clientWidth;
        }

        if (workspace && workspace.offsetWidth) {
            return workspace.offsetWidth;
        }

        return (WORKSPACE_PANE_MIN_WIDTH * 2) + WORKSPACE_DIVIDER_SIZE;
    }

    function workspaceRatioBounds(width) {
        var availableWidth = Math.max(
            WORKSPACE_PANE_MIN_WIDTH * 2,
            Math.max(1, width - WORKSPACE_DIVIDER_SIZE)
        );
        var minRatio = WORKSPACE_PANE_MIN_WIDTH / availableWidth;
        var maxRatio = 1 - minRatio;

        if (minRatio > maxRatio) {
            minRatio = WORKSPACE_DEFAULT_SOURCE_RATIO;
            maxRatio = WORKSPACE_DEFAULT_SOURCE_RATIO;
        }

        return {
            min: minRatio,
            max: maxRatio
        };
    }

    function clampWorkspaceRatio(ratio, width) {
        var parsed = parseFloat(ratio);
        var bounds = workspaceRatioBounds(width);

        if (!isFinite(parsed)) {
            parsed = WORKSPACE_DEFAULT_SOURCE_RATIO;
        }

        return Math.min(bounds.max, Math.max(bounds.min, parsed));
    }

    function updateWorkspaceDivider(context) {
        var divider = context && context.dividerNode ? context.dividerNode : null;
        var ratio = context && typeof context.sourceRatio === 'number'
            ? context.sourceRatio
            : WORKSPACE_DEFAULT_SOURCE_RATIO;
        var label = getString('workspaceDivider');

        if (!divider || typeof divider.setAttribute !== 'function') {
            return;
        }

        if (label) {
            divider.setAttribute('aria-label', label);
        }

        divider.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
    }

    function setWorkspaceRatio(context, ratio, options) {
        var clamped = clampWorkspaceRatio(ratio, workspaceWidth(context));
        var rootNode = context && context.root && context.root[0] ? context.root[0] : null;

        options = options || {};
        context.sourceRatio = clamped;

        if (rootNode && rootNode.style && typeof rootNode.style.setProperty === 'function') {
            rootNode.style.setProperty('--easymde-source-ratio', String(clamped));
        }

        updateWorkspaceDivider(context);

        if (options.persist !== false) {
            writeStoredWorkspaceRatio(context.storage, clamped);
        }

        return clamped;
    }

    function nudgeWorkspaceRatio(context, deltaPixels, options) {
        var width = Math.max(1, workspaceWidth(context) - WORKSPACE_DIVIDER_SIZE);

        return setWorkspaceRatio(
            context,
            context.sourceRatio + (deltaPixels / width),
            options
        );
    }

    function handleWorkspaceDividerKey(context, event) {
        var key = normalizeEventKey(event && event.key);

        switch (key) {
        case 'Left':
            if (event && typeof event.preventDefault === 'function') {
                event.preventDefault();
            }
            nudgeWorkspaceRatio(context, -WORKSPACE_KEYBOARD_STEP);
            return true;
        case 'Right':
            if (event && typeof event.preventDefault === 'function') {
                event.preventDefault();
            }
            nudgeWorkspaceRatio(context, WORKSPACE_KEYBOARD_STEP);
            return true;
        case 'Home':
            if (event && typeof event.preventDefault === 'function') {
                event.preventDefault();
            }
            setWorkspaceRatio(context, 0);
            return true;
        case 'End':
            if (event && typeof event.preventDefault === 'function') {
                event.preventDefault();
            }
            setWorkspaceRatio(context, 1);
            return true;
        default:
            return false;
        }
    }

    function bindWorkspaceDivider(context) {
        var divider = context && context.dividerNode ? context.dividerNode : null;
        var dragState = null;

        if (!divider || divider.easymdeWorkspaceDividerBound || typeof divider.addEventListener !== 'function') {
            return;
        }

        divider.easymdeWorkspaceDividerBound = true;

        divider.addEventListener('keydown', function (event) {
            handleWorkspaceDividerKey(context, event);
        });

        if (!window.PointerEvent) {
            return;
        }

        function endDrag(event) {
            if (!dragState) {
                return;
            }

            if (
                dragState.pointerId !== undefined
                && event
                && event.pointerId !== undefined
                && dragState.pointerId !== event.pointerId
            ) {
                return;
            }

            if (typeof divider.releasePointerCapture === 'function' && dragState.pointerId !== undefined) {
                try {
                    divider.releasePointerCapture(dragState.pointerId);
                } catch (error) {}
            }

            writeStoredWorkspaceRatio(context.storage, context.sourceRatio);
            dragState = null;
        }

        divider.addEventListener('pointerdown', function (event) {
            var width;

            if (event && event.pointerType === 'mouse' && event.button !== 0) {
                return;
            }

            width = workspaceWidth(context);
            if (!width) {
                return;
            }

            dragState = {
                pointerId: event && event.pointerId !== undefined ? event.pointerId : undefined,
                startX: event && typeof event.clientX === 'number' ? event.clientX : 0,
                startRatio: context.sourceRatio,
                width: width
            };

            if (typeof divider.setPointerCapture === 'function' && dragState.pointerId !== undefined) {
                try {
                    divider.setPointerCapture(dragState.pointerId);
                } catch (error) {}
            }

            if (event && typeof event.preventDefault === 'function') {
                event.preventDefault();
            }
        });

        window.addEventListener('pointermove', function (event) {
            if (!dragState) {
                return;
            }

            if (
                dragState.pointerId !== undefined
                && event
                && event.pointerId !== undefined
                && dragState.pointerId !== event.pointerId
            ) {
                return;
            }

            setWorkspaceRatio(
                context,
                dragState.startRatio + (
                    ((event && typeof event.clientX === 'number' ? event.clientX : dragState.startX) - dragState.startX)
                    / Math.max(1, dragState.width - WORKSPACE_DIVIDER_SIZE)
                ),
                { persist: false }
            );

            if (event && typeof event.preventDefault === 'function') {
                event.preventDefault();
            }
        }, true);

        window.addEventListener('pointerup', endDrag, true);
        window.addEventListener('pointercancel', endDrag, true);
    }

    function initializeWorkspaceLayout(context) {
        var storedRatio;

        if (!context) {
            return;
        }

        context.sourceRatio = WORKSPACE_DEFAULT_SOURCE_RATIO;
        storedRatio = readStoredWorkspaceRatio(context.storage);
        setWorkspaceRatio(
            context,
            storedRatio !== null ? storedRatio : WORKSPACE_DEFAULT_SOURCE_RATIO,
            { persist: false }
        );
        bindWorkspaceDivider(context);

        if (
            !context.workspaceResizeBound
            && window
            && typeof window.addEventListener === 'function'
        ) {
            context.workspaceResizeBound = true;
            window.addEventListener('resize', function () {
                setWorkspaceRatio(context, context.sourceRatio, { persist: false });
            });
        }
    }

    function createDraftNotice($root, textarea, storage, $flash) {
        var draft = window.EasyMDEDraftStorage.read(storage);

        if (!draft || !draft.content || draft.content === textarea.value) {
            return;
        }

        var $notice = $('<div class="easymde-draft-notice"></div>');
        var $message = $('<span></span>').text(getString('draftAvailable'));
        var $restore = $('<button type="button" class="button button-small"></button>').text(getString('restoreDraft'));
        var $discard = $('<button type="button" class="button button-small"></button>').text(getString('discardDraft'));

        $restore.on('click', function () {
            textarea.value = draft.content;
            $(textarea).trigger('input');
            $notice.remove();
            showFlash($flash, 'success', getString('draftRestored'));
        });

        $discard.on('click', function () {
            window.EasyMDEDraftStorage.discard(storage);
            $notice.remove();
            showFlash($flash, 'info', getString('draftDiscarded'));
        });

        if ($root.find('.easymde-editor-flash').length) {
            $root.find('.easymde-editor-flash').after($notice);
        } else {
            $root.find('.easymde-toolbar').after($notice);
        }
    }

    function hasLocalDraft(storage, savedMarkdownFingerprint) {
        var draft;
        var draftContentHash;

        if (
            (config.features && config.features.localDrafts === false)
            || !window.EasyMDEDraftStorage
        ) {
            return false;
        }

        if (
            savedMarkdownFingerprint
            && typeof window.EasyMDEDraftStorage.readContentHash === 'function'
        ) {
            draftContentHash = window.EasyMDEDraftStorage.readContentHash(storage);
            if (draftContentHash) {
                return draftContentHash !== savedMarkdownFingerprint;
            }
        }

        if (typeof window.EasyMDEDraftStorage.read !== 'function') {
            return typeof window.EasyMDEDraftStorage.exists === 'function'
                ? window.EasyMDEDraftStorage.exists(storage)
                : false;
        }

        draft = window.EasyMDEDraftStorage.read(storage);

        if (!draft || !Object.prototype.hasOwnProperty.call(draft, 'content') || typeof draft.content !== 'string') {
            return false;
        }

        if (!savedMarkdownFingerprint) {
            return true;
        }

        if (draft.contentHash) {
            return draft.contentHash !== savedMarkdownFingerprint;
        }

        if (typeof window.EasyMDEDraftStorage.contentFingerprint === 'function') {
            return window.EasyMDEDraftStorage.contentFingerprint(draft.content) !== savedMarkdownFingerprint;
        }

        return true;
    }

    function createDraftStatus($container) {
        var $status = $('<span class="easymde-draft-status" aria-live="polite"></span>');
        $container.append($status);

        return $status;
    }

    function syncMarkdownFields(markdown) {
        var markdownField = $('#easymde-markdown-field');

        if (markdownField.length) {
            markdownField.val(markdown);
        }

        syncThemeFields();
    }

    function mirrorToPostContent(markdown) {
        var editor = $('#content');

        syncMarkdownFields(markdown);
        editor.val(markdown);
    }

    function previewFallback(markdown) {
        if (!markdown.trim()) {
            return '<p class="easymde-preview-empty">' + escapeHtml(getString('previewEmpty')) + '</p>';
        }

        return '<pre class="easymde-preview-fallback">' + escapeHtml(markdown) + '</pre>';
    }

    function previewScopedConfig(features) {
        var scoped = {};
        var key;

        for (key in config) {
            if (Object.prototype.hasOwnProperty.call(config, key)) {
                scoped[key] = config[key];
            }
        }

        scoped.features = normalizePreviewFeatures(features || activePreviewFeatures);

        return scoped;
    }

    function currentPreviewSignature(markdown) {
        return [
            markdown,
            renderState.markdownTheme,
            renderState.codeTheme,
            renderState.codeMacStyle ? '1' : '0',
            renderState.customCssId || '',
            selectedCustomCss()
        ].join('\n');
    }

    function isPreviewCurrent(revision, signature, markdown) {
        return revision === previewRevision && signature === currentPreviewSignature(markdown);
    }

    function previewFeatureLoadFailed(result) {
        if (!result) {
            return false;
        }

        if (Array.isArray(result)) {
            return result.some(previewFeatureLoadFailed);
        }

        if (result.status === 'failed') {
            return true;
        }

        if (result.results) {
            return previewFeatureLoadFailed(result.results);
        }

        return false;
    }

    function previewHasRenderError($preview) {
        var preview = $preview[0];

        return !!(
            preview
            && typeof preview.querySelector === 'function'
            && preview.querySelector('.easymde-render-error')
        );
    }

    function enhancePreview($preview, features, revision, signature, markdown) {
        var scopedConfig = previewScopedConfig(features);
        var loaderContext = {
            config: config,
            renderState: renderState,
            documentRef: document
        };
        var loader = window.EasyMDEPreviewFeatureLoader;
        var loadPromise = loader && loader.ensurePreviewFeatures
            ? loader.ensurePreviewFeatures(scopedConfig.features, loaderContext)
            : Promise.resolve();

        return Promise.resolve(loadPromise).then(function (result) {
            if (previewFeatureLoadFailed(result)) {
                throw result;
            }

            if (!isPreviewCurrent(revision, signature, markdown)) {
                return false;
            }

            if (window.EasyMDEEnhancements) {
                return Promise.resolve(window.EasyMDEEnhancements.enhance($preview[0], scopedConfig)).then(function () {
                    if (previewHasRenderError($preview)) {
                        throw new Error('Preview enhancement failed.');
                    }

                    return true;
                });
            }

            return true;
        }).catch(function () {
            if (isPreviewCurrent(revision, signature, markdown)) {
                setPreviewEnhancementError($preview);
            }

            return false;
        });
    }

    function capturePreviewScroll(preview) {
        var scrollRange;

        if (!preview) {
            return null;
        }

        scrollRange = Math.max(1, preview.scrollHeight - preview.clientHeight);

        return {
            top: preview.scrollTop,
            left: preview.scrollLeft,
            ratio: preview.scrollTop / scrollRange
        };
    }

    function capturePreviewScrollIfMoved(preview) {
        if (!preview || (!preview.scrollTop && !preview.scrollLeft)) {
            return null;
        }

        return capturePreviewScroll(preview);
    }

    function restorePreviewScroll(preview, state) {
        var nextRange;

        if (!preview || !state) {
            return;
        }

        nextRange = Math.max(1, preview.scrollHeight - preview.clientHeight);
        syncLock = true;
        preview.scrollTop = Math.min(nextRange, Math.max(0, state.ratio * nextRange || state.top));
        preview.scrollLeft = state.left || 0;
        window.setTimeout(function () {
            syncLock = false;
        }, 30);
    }

    function getPreviewNode(context) {
        var preview = context && context.preview ? context.preview : null;

        if (preview && preview.jquery) {
            return preview[0];
        }

        return preview || null;
    }

    function captureEditorScrollState(context) {
        var textarea = context && context.textarea ? context.textarea : null;
        var preview = getPreviewNode(context);

        return {
            sourceTop: textarea ? textarea.scrollTop : 0,
            sourceLeft: textarea ? textarea.scrollLeft : 0,
            preview: capturePreviewScroll(preview)
        };
    }

    function restoreEditorScrollState(context, state) {
        if (!state) {
            return;
        }

        restoreScrollPosition(context.textarea, state.sourceTop, state.sourceLeft);
        restorePreviewScroll(getPreviewNode(context), state.preview);
    }

    function captureWindowScroll() {
        return {
            x: window.pageXOffset || document.documentElement.scrollLeft || document.body.scrollLeft || 0,
            y: window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0
        };
    }

    function ensureImmersiveTitleContext(context) {
        var titleLabel;

        if (!context) {
            return;
        }

        if (!context.immersiveHeaderNode) {
            context.immersiveHeaderNode = document.getElementById('easymde-immersive-header');
        }

        if (!context.immersiveTitleHostNode) {
            context.immersiveTitleHostNode = document.getElementById('easymde-immersive-title-host');
        }

        if (!context.nativeTitleField) {
            context.nativeTitleField = document.getElementById('title');
        }

        if (!context.nativeTitleWrap) {
            context.nativeTitleWrap = document.getElementById('titlewrap') || context.nativeTitleField;
        }

        titleLabel = getString('postTitle');
        if (
            titleLabel
            && context.nativeTitleField
            && typeof context.nativeTitleField.setAttribute === 'function'
        ) {
            context.nativeTitleField.setAttribute('aria-label', titleLabel);
        }
    }

    function toggleImmersiveTitleHost(context, enabled) {
        var header;
        var host;
        var titleWrap;
        var marker;
        var parentNode;

        ensureImmersiveTitleContext(context);

        header = context && context.immersiveHeaderNode ? context.immersiveHeaderNode : null;
        host = context && context.immersiveTitleHostNode ? context.immersiveTitleHostNode : null;
        titleWrap = context && context.nativeTitleWrap ? context.nativeTitleWrap : null;

        if (!header) {
            return;
        }

        header.hidden = !enabled;

        if (!enabled || !host || !titleWrap) {
            if (
                !enabled
                && host
                && titleWrap
                && titleWrap.parentNode === host
                && context.nativeTitleMarker
                && context.nativeTitleMarker.parentNode
            ) {
                context.nativeTitleMarker.parentNode.insertBefore(titleWrap, context.nativeTitleMarker);
                context.nativeTitleMarker.parentNode.removeChild(context.nativeTitleMarker);
            }

            return;
        }

        if (titleWrap.parentNode === host) {
            return;
        }

        parentNode = titleWrap.parentNode;
        if (!parentNode || typeof host.appendChild !== 'function') {
            return;
        }

        marker = context.nativeTitleMarker;
        if (!marker) {
            marker = document.createElement('span');
            marker.hidden = true;
            context.nativeTitleMarker = marker;
        }

        if (marker.parentNode !== parentNode && typeof parentNode.insertBefore === 'function') {
            parentNode.insertBefore(marker, titleWrap);
        }

        host.appendChild(titleWrap);
    }

    function updateImmersiveToggle(context) {
        var $button = context && context.immersiveButton ? context.immersiveButton : null;
        var isImmersive = context && context.root && context.root.hasClass('easymde-editor-immersive');
        var label = isImmersive
            ? getString('exitImmersive')
            : getString('enterImmersive');

        if (!$button || !$button.length) {
            return;
        }

        $button.empty();
        $button.attr('title', label);
        $button.attr('aria-label', label);
        $button.attr('aria-pressed', isImmersive ? 'true' : 'false');
        $button.toggleClass('is-active', !!isImmersive);
        $button.append(
            $('<span class="dashicons" aria-hidden="true"></span>').addClass(
                isImmersive ? 'dashicons-fullscreen-exit-alt' : 'dashicons-fullscreen-alt'
            )
        );
    }

    function setImmersiveMode(context, enabled) {
        var $root = context && context.root ? context.root : $();
        var isImmersive = $root.hasClass('easymde-editor-immersive');
        var scrollState;
        var focusTarget;

        if (!$root.length || enabled === isImmersive) {
            return;
        }

        ensureImmersiveTitleContext(context);
        focusTarget = (
            context
            && context.nativeTitleField
            && document.activeElement === context.nativeTitleField
        ) ? context.nativeTitleField : context.textarea;
        scrollState = captureEditorScrollState(context);
        closePopovers();

        if (enabled) {
            context.immersiveWindowScroll = captureWindowScroll();
        }

        $root.toggleClass('easymde-editor-immersive', enabled);
        $('html, body').toggleClass('easymde-immersive-active', enabled);
        toggleImmersiveTitleHost(context, enabled);
        updateImmersiveToggle(context);
        updateImmersiveUtilityState(context);

        window.requestAnimationFrame(function () {
            restoreEditorScrollState(context, scrollState);

            if (!enabled && context.immersiveWindowScroll) {
                window.scrollTo(context.immersiveWindowScroll.x, context.immersiveWindowScroll.y);
                context.immersiveWindowScroll = null;
            }

            focusWithoutScrolling(focusTarget);
        });
    }

    function setPreviewBusy($preview, busy) {
        $preview.attr('aria-busy', busy ? 'true' : 'false');
    }

    function previewHasRenderedContent($preview) {
        var preview = $preview[0];
        var firstElement;
        var firstElementClasses;

        if (!preview || !preview.firstChild) {
            return false;
        }

        firstElement = preview.firstElementChild;
        firstElementClasses = firstElement && firstElement.classList ? firstElement.classList : null;

        return !(
            firstElementClasses
            && (
                firstElementClasses.contains('easymde-preview-empty')
                || firstElementClasses.contains('easymde-preview-pending')
                || firstElementClasses.contains('easymde-preview-error')
            )
        );
    }

    function setPreviewPending($preview, replaceContent) {
        setPreviewBusy($preview, true);
        $preview.attr('data-easymde-preview-refreshing', '1');
        $preview.removeAttr('data-easymde-preview-error');

        if (replaceContent) {
            $preview.html('<p class="easymde-preview-pending" role="status">' + escapeHtml(getString('previewRendering')) + '</p>');
        }
    }

    function setPreviewReady($preview) {
        setPreviewBusy($preview, false);
        $preview.removeAttr('data-easymde-preview-error');
        $preview.removeAttr('data-easymde-preview-refreshing');
    }

    function setPreviewEnhancementError($preview) {
        setPreviewBusy($preview, false);
        $preview.attr('data-easymde-preview-error', '1');
        $preview.removeAttr('data-easymde-preview-refreshing');
    }

    function afterPreviewIdle(callback) {
        var fallbackTimer;
        var called = false;

        function run() {
            if (called) {
                return;
            }

            called = true;
            callback();
        }

        if (window.requestIdleCallback) {
            fallbackTimer = window.setTimeout(run, 500);
            window.requestIdleCallback(function () {
                window.clearTimeout(fallbackTimer);
                run();
            }, { timeout: 500 });
            return;
        }

        window.setTimeout(run, 60);
    }

    function canUseImagePasteUpload() {
        return !!(
            config.imageUpload
            && config.imageUpload.enabled
            && config.imageUploadUrl
            && config.imagePasteScriptUrl
            && config.nonce
        );
    }

    function eventTransfer(event) {
        return event && (event.clipboardData || event.dataTransfer) ? event.clipboardData || event.dataTransfer : null;
    }

    function hasImageFileTransfer(transfer) {
        var items = transfer && transfer.items ? transfer.items : [];
        var files = transfer && transfer.files ? transfer.files : [];
        var index;
        var file;
        var type;

        for (index = 0; index < items.length; index += 1) {
            if (!items[index] || items[index].kind !== 'file') {
                continue;
            }

            type = items[index].type || '';
            if (/^image\//i.test(type)) {
                return true;
            }
        }

        for (index = 0; index < files.length; index += 1) {
            file = files[index];
            if (file && /^image\//i.test(file.type || '')) {
                return true;
            }
        }

        return false;
    }

    function firstImageFileFromTransfer(transfer) {
        var items = transfer && transfer.items ? transfer.items : [];
        var files = transfer && transfer.files ? transfer.files : [];
        var index;
        var file;
        var type;

        for (index = 0; index < items.length; index += 1) {
            if (!items[index] || items[index].kind !== 'file') {
                continue;
            }

            type = items[index].type || '';
            if (type && !/^image\//i.test(type)) {
                continue;
            }

            file = typeof items[index].getAsFile === 'function' ? items[index].getAsFile() : null;
            if (file && /^image\//i.test(file.type || type)) {
                return file;
            }
        }

        for (index = 0; index < files.length; index += 1) {
            file = files[index];
            if (file && /^image\//i.test(file.type || '')) {
                return file;
            }
        }

        return null;
    }

    function eventHasImageFileTransfer(event) {
        return hasImageFileTransfer(eventTransfer(event));
    }

    function selectedTextareaRange(textarea) {
        var fallback = textarea && typeof textarea.value === 'string' ? textarea.value.length : 0;
        var start = textarea && typeof textarea.selectionStart === 'number' ? textarea.selectionStart : fallback;
        var end = textarea && typeof textarea.selectionEnd === 'number' ? textarea.selectionEnd : start;

        return {
            end: end,
            start: start,
            value: textarea && typeof textarea.value === 'string' ? textarea.value : ''
        };
    }

    function captureImageTransfer(event, textarea) {
        return {
            file: firstImageFileFromTransfer(eventTransfer(event)),
            range: selectedTextareaRange(textarea)
        };
    }

    function preventImageTransferDefault(event) {
        if (event && typeof event.preventDefault === 'function') {
            event.preventDefault();
        }

        if (event && event.dataTransfer) {
            event.dataTransfer.dropEffect = 'copy';
        }
    }

    function imagePasteFailureMessage(source) {
        if (source === 'drop') {
            return getString('imageDropFailed') || getString('imagePasteFailed');
        }

        return getString('imagePasteFailed');
    }

    function imagePasteOptions($root, $flash) {
        return {
            applyTextChange: applyTextChange,
            config: config,
            flash: $flash,
            getString: getString,
            postId: $root.data('post-id') || 0,
            showFlash: showFlash
        };
    }

    function bindImagePaste(textarea, $root, $flash) {
        if (!textarea || !window.EasyMDEImagePaste || !window.EasyMDEImagePaste.bind) {
            return false;
        }

        window.EasyMDEImagePaste.bind(textarea, imagePasteOptions($root, $flash));
        return !!textarea.easymdeImagePasteBound;
    }

    function loadDeferredScript(id, src) {
        if (
            !src
            || !previewFeatureLoader
            || typeof previewFeatureLoader.loadScript !== 'function'
        ) {
            return Promise.resolve(false);
        }

        return previewFeatureLoader.loadScript(id, src, document).then(function (result) {
            return !(result && result.status === 'failed');
        });
    }

    function ensureImagePasteBound(textarea, $root, $flash) {
        if (bindImagePaste(textarea, $root, $flash)) {
            return Promise.resolve(true);
        }

        if (!canUseImagePasteUpload()) {
            return Promise.resolve(false);
        }

        if (!imagePasteLoadPromise) {
            imagePasteLoadPromise = loadDeferredScript(
                'easymde-image-paste-js',
                config.imagePasteScriptUrl
            );
        }

        return imagePasteLoadPromise.then(function (loaded) {
            return loaded && bindImagePaste(textarea, $root, $flash);
        });
    }

    function bindLazyImagePasteUpload(textarea, $root, $flash) {
        function replayWhenLoaded(event, handlerName, source) {
            var transfer;

            if (textarea.easymdeImagePasteBound || !eventHasImageFileTransfer(event)) {
                return;
            }

            transfer = captureImageTransfer(event, textarea);
            preventImageTransferDefault(event);
            ensureImagePasteBound(textarea, $root, $flash).then(function (loaded) {
                if (
                    loaded
                    && window.EasyMDEImagePaste
                    && source !== 'dragover'
                    && transfer.file
                    && typeof window.EasyMDEImagePaste.handleFile === 'function'
                ) {
                    window.EasyMDEImagePaste.handleFile(
                        transfer.file,
                        event,
                        textarea,
                        imagePasteOptions($root, $flash),
                        source,
                        transfer.range
                    );
                    return;
                }

                if (
                    loaded
                    && window.EasyMDEImagePaste
                    && typeof window.EasyMDEImagePaste[handlerName] === 'function'
                ) {
                    window.EasyMDEImagePaste[handlerName](event, textarea, imagePasteOptions($root, $flash));
                    return;
                }

                if (source !== 'dragover') {
                    showFlash($flash, 'error', imagePasteFailureMessage(source));
                }
            });
        }

        if (bindImagePaste(textarea, $root, $flash)) {
            return true;
        }

        if (
            !textarea
            || textarea.easymdeImagePasteLazyBound
            || typeof textarea.addEventListener !== 'function'
            || !canUseImagePasteUpload()
        ) {
            return false;
        }

        textarea.easymdeImagePasteLazyBound = true;
        textarea.addEventListener('paste', function (event) {
            replayWhenLoaded(event, 'handlePaste', 'paste');
        });
        textarea.addEventListener('dragover', function (event) {
            replayWhenLoaded(event, 'handleDragOver', 'dragover');
        });
        textarea.addEventListener('drop', function (event) {
            replayWhenLoaded(event, 'handleDrop', 'drop');
        });

        return true;
    }

    function copyWechat(context) {
        var callbacks = {
            getString: getString,
            showFlash: showFlash
        };

        if (window.EasyMDEWechatExporter && window.EasyMDEWechatExporter.copy) {
            window.EasyMDEWechatExporter.copy(context, callbacks);
            return;
        }

        preloadWechatExporter();
        showFlash(context && context.flash ? context.flash : null, 'error', getString('copyWechatFailed'));
    }

    function preloadWechatExporter() {
        if (
            !config.wechatExporterScriptUrl
            || (config.features && config.features.wechatCopy === false)
            || (window.EasyMDEWechatExporter && window.EasyMDEWechatExporter.copy)
        ) {
            return Promise.resolve(true);
        }

        if (!wechatExporterLoadPromise) {
            wechatExporterLoadPromise = loadDeferredScript(
                'easymde-wechat-exporter-js',
                config.wechatExporterScriptUrl
            );
        }

        return wechatExporterLoadPromise;
    }

    function mediaPickerOptions() {
        return {
            title: getString('insertMedia'),
            altText: getString('mediaAltText'),
            defaultAlt: getString('mediaDefaultAlt'),
            insertAround: insertAround,
            applyTextChange: applyTextChange
        };
    }

    function insertMediaPlaceholder(textarea) {
        insertAround(textarea, '![' + getString('mediaAltText') + '](', ')', '');
    }

    function openLoadedMediaPicker(textarea) {
        if (!textarea || !window.EasyMDEMediaPicker || !window.EasyMDEMediaPicker.open) {
            return false;
        }

        window.EasyMDEMediaPicker.open(textarea, mediaPickerOptions());
        return true;
    }

    function openMediaPicker(textarea) {
        if (openLoadedMediaPicker(textarea)) {
            return Promise.resolve(true);
        }

        if (!mediaPickerLoadPromise) {
            mediaPickerLoadPromise = loadDeferredScript(
                'easymde-media-picker-js',
                config.mediaPickerScriptUrl
            );
        }

        return mediaPickerLoadPromise.then(function (loaded) {
            if (loaded && openLoadedMediaPicker(textarea)) {
                return true;
            }

            insertMediaPlaceholder(textarea);
            return false;
        });
    }

    function previewNeedsDeferredEnhancement(features) {
        features = normalizePreviewFeatures(features || activePreviewFeatures);

        return !!(
            features.syntaxHighlight
            || features.math
            || features.mermaid
            || features.toc
            || (features.codeBlocks && renderState.codeMacStyle)
        );
    }

    function initialPreviewFeatures($preview) {
        var raw = $preview.attr('data-easymde-preview-features');

        if (!raw) {
            return null;
        }

        try {
            return JSON.parse(raw);
        } catch (error) {
            return null;
        }
    }

    function hydrateInitialPreview($preview, markdown, options) {
        var previewNode = $preview[0];
        var features;
        var revision;
        var scheduleEnhancement;
        var signature;
        var scrollState;

        options = options || {};

        if ($preview.attr('data-easymde-initial-preview') !== '1' || !previewHasRenderedContent($preview)) {
            return false;
        }

        window.clearTimeout(previewTimer);
        abortPreviewRequest();

        features = normalizePreviewFeatures(initialPreviewFeatures($preview) || config.features || {});
        activePreviewFeatures = features;
        revision = ++previewRevision;
        signature = currentPreviewSignature(markdown);
        scrollState = capturePreviewScrollIfMoved(previewNode);

        setPreviewReady($preview);

        applyRenderState($preview, features, { syncFields: false });

        afterPreviewIdle(function () {
            if (!isPreviewCurrent(revision, signature, markdown)) {
                return;
            }

            restorePreviewScroll(previewNode, scrollState);
        });

        if (!previewNeedsDeferredEnhancement(features)) {
            return true;
        }

        setPreviewPending($preview, false);
        scheduleEnhancement = function (currentMarkdown) {
            var enhancementMarkdown = typeof currentMarkdown === 'string' ? currentMarkdown : markdown;
            var enhancementRevision = revision;
            var enhancementSignature = currentPreviewSignature(enhancementMarkdown);

            afterPreviewIdle(function () {
                if (!isPreviewCurrent(enhancementRevision, enhancementSignature, enhancementMarkdown)) {
                    return;
                }

                enhancePreview($preview, features, enhancementRevision, enhancementSignature, enhancementMarkdown).then(function (ready) {
                    finishEnhancedPreview($preview, enhancementRevision, enhancementSignature, enhancementMarkdown, ready);
                });
            });
        };

        if (typeof options.deferEnhancement === 'function') {
            options.deferEnhancement(scheduleEnhancement);
            return true;
        }

        scheduleEnhancement();

        return true;
    }

    function finishEnhancedPreview($preview, revision, signature, markdown, ready) {
        if (ready !== false && isPreviewCurrent(revision, signature, markdown)) {
            setPreviewReady($preview);
        }
    }

    function abortPreviewRequest() {
        if (previewAbortController && typeof previewAbortController.abort === 'function') {
            previewAbortController.abort();
        }

        previewAbortController = null;
    }

    function updatePreview($preview, markdown, options) {
        var previewNode = $preview[0];
        var revision = ++previewRevision;
        var signature = currentPreviewSignature(markdown);
        var delay;

        options = options || {};
        delay = options.immediate ? 0 : 180;

        function finishPreviewUpdate(scrollState, features) {
            applyRenderState($preview, features);
            restorePreviewScroll(previewNode, scrollState);
        }

        window.clearTimeout(previewTimer);
        abortPreviewRequest();

        if (!markdown.trim()) {
            activePreviewFeatures = normalizePreviewFeatures(config.features || {});
            setPreviewReady($preview);
            $preview.html('<p class="easymde-preview-empty">' + escapeHtml(getString('previewEmpty')) + '</p>');
            finishPreviewUpdate(capturePreviewScroll(previewNode), activePreviewFeatures);
            return;
        }

        setPreviewPending($preview, !previewHasRenderedContent($preview));

        function runPreviewRequest() {
            var requestScrollState;
            var fetchOptions;

            if (!isPreviewCurrent(revision, signature, markdown)) {
                return;
            }

            previewTimer = null;
            requestScrollState = capturePreviewScroll(previewNode);

            if (!window.wp || !window.wp.apiFetch || !config.restUrl) {
                activePreviewFeatures = normalizePreviewFeatures(config.features || {});
                $preview.html(previewFallback(markdown));
                finishPreviewUpdate(requestScrollState, activePreviewFeatures);
                enhancePreview($preview, activePreviewFeatures, revision, signature, markdown).then(function (ready) {
                    finishEnhancedPreview($preview, revision, signature, markdown, ready);
                });
                return;
            }

            if (window.AbortController) {
                previewAbortController = new window.AbortController();
            }

            fetchOptions = {
                url: config.restUrl,
                method: 'POST',
                headers: {
                    'X-WP-Nonce': config.nonce
                },
                data: {
                    markdown: markdown,
                    post_id: $('#easymde-editor').data('post-id') || 0,
                    markdown_theme: renderState.markdownTheme,
                    code_theme: renderState.codeTheme,
                    code_mac_style: renderState.codeMacStyle,
                    custom_css_id: renderState.customCssId
                }
            };

            if (previewAbortController) {
                fetchOptions.signal = previewAbortController.signal;
            }

            window.wp.apiFetch(fetchOptions).then(function (response) {
                var responseFeatures;

                if (!isPreviewCurrent(revision, signature, markdown)) {
                    return;
                }

                response = response || {};
                responseFeatures = normalizePreviewFeatures(response.features || {});
                activePreviewFeatures = responseFeatures;
                $preview.html(response.html || previewFallback(markdown));
                finishPreviewUpdate(requestScrollState, responseFeatures);
                enhancePreview($preview, responseFeatures, revision, signature, markdown).then(function (ready) {
                    finishEnhancedPreview($preview, revision, signature, markdown, ready);
                });
            }).catch(function (error) {
                if (!isPreviewCurrent(revision, signature, markdown) || (error && error.name === 'AbortError')) {
                    return;
                }

                activePreviewFeatures = normalizePreviewFeatures(config.features || {});
                setPreviewReady($preview);
                $preview.html('<p class="easymde-preview-error">' + escapeHtml(getString('previewError')) + '</p>');
                finishPreviewUpdate(requestScrollState, activePreviewFeatures);
            });
        }

        if (delay <= 0) {
            runPreviewRequest();
            return;
        }

        previewTimer = window.setTimeout(runPreviewRequest, delay);
    }

    function bindScrollSync(textarea, preview) {
        $(textarea).on('scroll', function () {
            if (syncLock) {
                return;
            }

            syncLock = true;
            var ratio = textarea.scrollTop / Math.max(1, textarea.scrollHeight - textarea.clientHeight);
            preview.scrollTop = ratio * Math.max(1, preview.scrollHeight - preview.clientHeight);
            window.setTimeout(function () {
                syncLock = false;
            }, 30);
        });

        $(preview).on('scroll', function () {
            if (syncLock) {
                return;
            }

            syncLock = true;
            var ratio = preview.scrollTop / Math.max(1, preview.scrollHeight - preview.clientHeight);
            textarea.scrollTop = ratio * Math.max(1, textarea.scrollHeight - textarea.clientHeight);
            window.setTimeout(function () {
                syncLock = false;
            }, 30);
        });
    }

    function normalizeEventKey(key) {
        if (!key) {
            return '';
        }

        var map = {
            Tab: 'Tab',
            Enter: 'Enter',
            Escape: 'Escape',
            Esc: 'Escape',
            Backspace: 'Backspace',
            Delete: 'Delete',
            ArrowUp: 'Up',
            ArrowDown: 'Down',
            ArrowLeft: 'Left',
            ArrowRight: 'Right',
            Home: 'Home',
            End: 'End',
            PageUp: 'PageUp',
            PageDown: 'PageDown',
            ' ': 'Space'
        };

        if (map[key]) {
            return map[key];
        }

        if (key === 'Shift' || key === 'Alt' || key === 'Control' || key === 'Meta') {
            return '';
        }

        if (/^F([1-9]|1[0-2])$/.test(key)) {
            return key;
        }

        if (key.length === 1) {
            if (/[a-z]/i.test(key)) {
                return key.toUpperCase();
            }

            if (/[0-9\[\]`\\/\.,\-=]/.test(key)) {
                return key;
            }
        }

        return '';
    }

    function normalizeEventShortcut(event) {
        var key = normalizeEventKey(event.key);
        var parts = [];

        if (!key) {
            return '';
        }

        if (getIsMac()) {
            if (event.metaKey) {
                parts.push('Cmd');
            }
            if (event.ctrlKey) {
                parts.push('Ctrl');
            }
            if (event.altKey) {
                parts.push('Option');
            }
            if (event.shiftKey) {
                parts.push('Shift');
            }
        } else {
            if (event.ctrlKey) {
                parts.push('Ctrl');
            }
            if (event.altKey) {
                parts.push('Alt');
            }
            if (event.shiftKey) {
                parts.push('Shift');
            }
            if (event.metaKey) {
                parts.push('Meta');
            }
        }

        if (!parts.length) {
            return '';
        }

        parts.push(key);

        return parts.join('+');
    }

    function shouldHandleShortcut(event, $root, textarea) {
        var target = event.target;

        if (!target || event.isComposing) {
            return false;
        }

        if (!$.contains($root[0], target) && target !== $root[0]) {
            return false;
        }

        if (target === textarea) {
            return true;
        }

        if ($(target).is('input, textarea, select')) {
            return false;
        }

        return true;
    }

    function bindShortcuts($root, textarea, context) {
        document.addEventListener('keydown', function (event) {
            var shortcut;
            var matchedCommand = null;

            if (!shouldHandleShortcut(event, $root, textarea)) {
                return;
            }

            shortcut = normalizeEventShortcut(event);
            if (!shortcut) {
                if ('Escape' === normalizeEventKey(event.key)) {
                    closePopovers();
                }
                return;
            }

            Object.keys(getCommandMap()).some(function (commandId) {
                if (getShortcutForCommand(commandId) === shortcut) {
                    matchedCommand = commandId;
                    return true;
                }

                return false;
            });

            if (!matchedCommand) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            executeCommand(matchedCommand, context);
        }, true);

        document.addEventListener('click', function () {
            closePopovers();
        });
    }

    function executeCommand(commandId, context) {
        var command = getCommand(commandId);
        var textarea = context && context.textarea ? context.textarea : document.getElementById('easymde-source');

        if (!command || !textarea) {
            return;
        }

        switch (command.action) {
        case 'wrap':
            insertAround(textarea, command.prefix || '', command.suffix || '', command.placeholder || '');
            break;
        case 'heading':
            setHeadingLevel(textarea, command.level || 2);
            break;
        case 'paragraph':
            setHeadingLevel(textarea, 0);
            break;
        case 'quote':
            applyLinePrefix(textarea, command.linePrefix || '> ');
            break;
        case 'unorderedList':
            applyLinePrefix(textarea, command.linePrefix || '- ');
            break;
        case 'orderedList':
            applyOrderedList(textarea);
            break;
        case 'codeFence':
            insertBlock(textarea, '```\n', '\n```', 'code');
            break;
        case 'mathBlock':
            insertBlock(textarea, '$$\n', '\n$$', 'E = mc^2');
            break;
        case 'link':
            insertAround(textarea, '[', '](https://)', getString('linkText'));
            break;
        case 'image':
            openMediaPicker(textarea);
            break;
        case 'savePost':
            triggerSavePost();
            break;
        case 'copyWechat':
            copyWechat(context);
            break;
        case 'linePrefix':
            applyLinePrefix(textarea, command.linePrefix || '');
            break;
        default:
            if (command.prefix || command.suffix) {
                insertAround(textarea, command.prefix || '', command.suffix || '', command.placeholder || '');
            } else if (command.linePrefix) {
                applyLinePrefix(textarea, command.linePrefix);
            }
        }
    }

    function createToolbar($toolbar, context) {
        var $main = $('<div class="easymde-toolbar-section easymde-toolbar-section-main"></div>');
        var $secondary = $('<div class="easymde-toolbar-section easymde-toolbar-section-secondary"></div>');
        var formatCommands = getGroupCommands('main', 'format');
        var blockCommands = getGroupCommands('main', 'block');
        var insertCommands = getGroupCommands('main', 'insert');
        var exportCommands = getGroupCommands('main', 'export');

        $toolbar.empty();

        formatCommands.forEach(function (command) {
            $main.append(createCommandButton(command, { compact: true, context: context }));
        });

        createHeadingMenu($main, context.textarea);

        if (blockCommands.length) {
            $main.append($('<span class="easymde-toolbar-divider" aria-hidden="true"></span>'));
            blockCommands.forEach(function (command) {
                $main.append(createCommandButton(command, { compact: true, context: context }));
            });
        }

        if (insertCommands.length) {
            $main.append($('<span class="easymde-toolbar-divider" aria-hidden="true"></span>'));
            insertCommands.forEach(function (command) {
                $main.append(createCommandButton(command, { compact: true, context: context }));
            });
        }

        exportCommands.forEach(function (command) {
            $secondary.append(createCommandButton(command, {
                compact: true,
                className: 'easymde-toolbar-copy-action',
                context: context
            }));
        });

        if (exportCommands.length) {
            $secondary.append($('<span class="easymde-toolbar-divider" aria-hidden="true"></span>'));
        }

        createPublishPanelButton($secondary, context);
        createImmersiveToggleButton($secondary, context);
        createOutlineToggleButton($secondary, context);
        createWordStatsControl($secondary, context);
        createFontMenu($secondary, context.preview);
        createAppearanceMenu($secondary, context.root, context.preview, context.refreshPreview);
        context.draftStatus = createDraftStatus($secondary);

        $toolbar.append($main, $secondary);
        updateImmersiveUtilityState(context);

        return context.draftStatus;
    }

    function createImmersiveToggleButton($container, context) {
        var $button = $('<button type="button" class="easymde-toolbar-button easymde-toolbar-button-compact easymde-toolbar-immersive-toggle"></button>');

        context.immersiveButton = $button;
        updateImmersiveToggle(context);

        $button.on('mousedown', function (event) {
            event.preventDefault();
        });

        $button.on('click', function () {
            setImmersiveMode(context, !context.root.hasClass('easymde-editor-immersive'));
        });

        $container.append($button);
    }

    function outlineEntryClassName(level, active) {
        var classes = ['easymde-outline-entry', 'easymde-outline-entry-level-' + String(level)];

        if (active) {
            classes.push('is-active');
        }

        return classes.join(' ');
    }

    function setActiveOutlineIndex(context, index) {
        context.activeOutlineIndex = typeof index === 'number' ? index : -1;
        renderOutlineRail(context);
    }

    function sourceLineHeight(textarea) {
        var lineHeight = 24;
        var computed;
        var parsed;

        if (!textarea || !window.getComputedStyle) {
            return lineHeight;
        }

        computed = window.getComputedStyle(textarea);
        parsed = computed ? parseFloat(computed.lineHeight) : NaN;

        return isFinite(parsed) ? parsed : lineHeight;
    }

    function scrollSourceToOffset(context, offset) {
        var textarea = context && context.textarea ? context.textarea : null;
        var safeOffset;
        var normalizedBefore;
        var lineNumber;

        if (!textarea || typeof textarea.value !== 'string') {
            return;
        }

        safeOffset = Math.max(0, Math.min(offset, textarea.value.length));
        normalizedBefore = String(textarea.value.slice(0, safeOffset)).replace(/\r\n?/g, '\n');
        lineNumber = normalizedBefore ? normalizedBefore.split('\n').length - 1 : 0;

        if (typeof textarea.setSelectionRange === 'function') {
            textarea.setSelectionRange(safeOffset, safeOffset);
        }

        textarea.scrollTop = Math.max(0, (lineNumber * sourceLineHeight(textarea)) - (textarea.clientHeight / 3));
        focusWithoutScrolling(textarea);
    }

    function scrollPreviewToOutlineIndex(context, index) {
        var previewNode = context && context.preview && context.preview[0] ? context.preview[0] : null;
        var headings;
        var heading;

        if (!previewNode || typeof previewNode.querySelectorAll !== 'function') {
            return;
        }

        headings = previewNode.querySelectorAll('h1, h2, h3, h4, h5, h6');
        heading = headings && headings[index] ? headings[index] : null;

        if (heading && typeof heading.scrollIntoView === 'function') {
            heading.scrollIntoView({
                block: 'center',
                inline: 'nearest'
            });
        }
    }

    function renderOutlineRail(context) {
        var $rail = context && context.outlineRail ? context.outlineRail : $();
        var immersive = context && context.root && context.root.hasClass('easymde-editor-immersive');
        var headings = context && context.outlineHeadings ? context.outlineHeadings : [];

        if (!$rail.length) {
            return;
        }

        context.root.toggleClass('easymde-outline-open', !!(immersive && context.outlineOpen));
        $rail.prop('hidden', !(immersive && context.outlineOpen));

        if (!(immersive && context.outlineOpen)) {
            return;
        }

        $rail.empty();
        $rail.append(
            $('<p class="easymde-outline-panel-title"></p>').text(getString('documentOutline'))
        );

        if (!headings.length) {
            $rail.append(
                $('<p class="easymde-outline-empty" role="status"></p>').text(getString('outlineEmpty'))
            );
            return;
        }

        var $list = $('<div class="easymde-outline-list"></div>');

        headings.forEach(function (heading, index) {
            var isActive = index === context.activeOutlineIndex;
            var $entry = $('<button type="button"></button>');

            $entry
                .addClass(outlineEntryClassName(heading.level, isActive))
                .attr('aria-current', isActive ? 'location' : null)
                .text(heading.text);

            $entry.on('click', function () {
                setActiveOutlineIndex(context, index);
                scrollSourceToOffset(context, heading.offset);
                scrollPreviewToOutlineIndex(context, index);
            });

            $list.append($entry);
        });

        $rail.append($list);
    }

    function toggleOutlineOpen(context, enabled) {
        context.outlineOpen = !!enabled;
        renderOutlineRail(context);

        if (context.outlineButton && context.outlineButton.length) {
            context.outlineButton
                .toggleClass('is-active', !!enabled)
                .attr('aria-pressed', enabled ? 'true' : 'false');
        }
    }

    function formatReadingTime(context) {
        var stats = context && context.wordStats ? context.wordStats : null;
        var minutes = stats ? stats.readingMinutes : 0;
        var unit = getString('readingTimeUnit') || 'min';

        return String(minutes) + ' ' + unit;
    }

    function renderWordStatsPanel(context) {
        var $panel = context && context.wordStatsPanel ? context.wordStatsPanel : $();
        var stats = context && context.wordStats ? context.wordStats : calculateWordStatistics('');
        var rows;

        if (!$panel.length) {
            return;
        }

        rows = [
            [getString('readingTime'), formatReadingTime(context)],
            [getString('lineCount'), String(stats.lineCount)],
            [getString('westernWordCount'), String(stats.westernWords)],
            [getString('cjkCharacterCount'), String(stats.cjkCharacters)],
            [getString('totalCharacterCount'), String(stats.totalCharacters)]
        ];

        $panel.empty();

        var $grid = $('<div class="easymde-word-stats-grid"></div>');
        rows.forEach(function (row) {
            $grid.append(
                $('<span class="easymde-word-stats-label"></span>').text(row[0]),
                $('<span class="easymde-word-stats-value"></span>').text(row[1])
            );
        });

        $panel.append($grid);
        $panel.append(
            $('<p class="easymde-word-stats-help"></p>').text(getString('readingTimeHelp'))
        );
    }

    function applyWorkspaceDerivedState(context, markdown) {
        context.outlineHeadings = extractOutlineHeadings(markdown);
        context.wordStats = calculateWordStatistics(markdown);

        if (context.activeOutlineIndex >= context.outlineHeadings.length) {
            context.activeOutlineIndex = -1;
        }

        renderOutlineRail(context);
        renderWordStatsPanel(context);
    }

    function scheduleWorkspaceDerivedStateUpdate(context, markdown) {
        var schedule = window.requestAnimationFrame || function (callback) {
            return window.setTimeout(callback, 0);
        };
        var cancel = window.cancelAnimationFrame || window.clearTimeout;

        if (context.workspaceDerivedStateFrame) {
            cancel(context.workspaceDerivedStateFrame);
        }

        context.workspaceDerivedStateFrame = schedule(function () {
            context.workspaceDerivedStateFrame = null;
            applyWorkspaceDerivedState(context, markdown);
        });
    }

    function createOutlineToggleButton($container, context) {
        var label = getString('documentOutline');
        var $button = createUtilityButton(label, 'dashicons-list-view', 'easymde-toolbar-outline-toggle');

        context.outlineButton = $button;
        $button.attr('aria-pressed', 'false');
        $button.prop('hidden', true);

        $button.on('mousedown', function (event) {
            event.preventDefault();
        });

        $button.on('click', function () {
            toggleOutlineOpen(context, !context.outlineOpen);
        });

        $container.append($button);
    }

    function createWordStatsControl($container, context) {
        var label = getString('wordStats');
        var $anchor = createMenuAnchor('easymde-toolbar-popover-stats');
        var $button = createUtilityButton(label, 'dashicons-chart-bar', 'easymde-toolbar-word-stats-toggle');
        var $panel = $('<div class="easymde-toolbar-popover easymde-word-stats-popover" hidden></div>');

        context.wordStatsAnchor = $anchor;
        context.wordStatsButton = $button;
        context.wordStatsPanel = $panel;

        $anchor.prop('hidden', true);

        registerPopover($button, $panel, {
            beforeOpen: function () {
                renderWordStatsPanel(context);
            }
        });

        $anchor.append($button, $panel);
        $container.append($anchor);
    }

    function updateImmersiveUtilityState(context) {
        var immersive = context && context.root && context.root.hasClass('easymde-editor-immersive');

        if (context.outlineButton && context.outlineButton.length) {
            context.outlineButton.prop('hidden', !immersive);
        }

        if (context.wordStatsAnchor && context.wordStatsAnchor.length) {
            context.wordStatsAnchor.prop('hidden', !immersive);
        }

        if (!immersive) {
            toggleOutlineOpen(context, false);
        } else {
            renderOutlineRail(context);
        }
    }

    function readCheckedCategoryIdsFromDom() {
        var inputs = document.querySelectorAll
            ? document.querySelectorAll('#categorychecklist input[type="checkbox"]:checked, #categorychecklist-pop input[type="checkbox"]:checked')
            : [];

        return normalizeCategoryIds(Array.prototype.map.call(inputs || [], function (input) {
            return input && input.value ? input.value : '';
        }));
    }

    function readAvailableCategoryOptionsFromDom() {
        var inputs = document.querySelectorAll
            ? document.querySelectorAll('#categorychecklist input[type="checkbox"]')
            : [];

        return Array.prototype.map.call(inputs || [], function (input) {
            var label = '';

            if (input && input.parentNode && typeof input.parentNode.textContent === 'string') {
                label = input.parentNode.textContent.replace(/\s+/g, ' ').trim();
            }

            return {
                id: input && input.value ? String(input.value) : '',
                label: label || (input && input.value ? String(input.value) : ''),
                checked: !!(input && input.checked)
            };
        }).filter(function (option) {
            return !!option.id;
        });
    }

    function readNativePublishState(context) {
        var reader = context && context.nativePublishStateReader ? context.nativePublishStateReader : null;
        var siteOrigin = config.siteOrigin || (window.location && window.location.origin ? window.location.origin : '');
        var featuredImageId = $('#_thumbnail_id').val ? $('#_thumbnail_id').val() : '';
        var sourceMarkdown = context && context.textarea && typeof context.textarea.value === 'string'
            ? context.textarea.value
            : '';
        var featuredImageCandidate = findFirstLocalImageCandidate(sourceMarkdown, siteOrigin);

        if (typeof reader === 'function') {
            return reader();
        }

        return {
            categories: readCheckedCategoryIdsFromDom(),
            categoryOptions: readAvailableCategoryOptionsFromDom(),
            excerpt: $('#excerpt').val ? String($('#excerpt').val() || '') : '',
            featuredImageId: featuredImageId,
            featuredImageCandidate: featuredImageCandidate,
            postStatus: $('#post_status').val ? String($('#post_status').val() || '') : '',
            tags: normalizeTagList($('#tax-input-post_tag').val ? $('#tax-input-post_tag').val() : '')
        };
    }

    function readPublishPanelDraftFromNative(context) {
        var nativeState = readNativePublishState(context);

        return createPublishPanelDraft({
            categories: nativeState.categories,
            excerpt: nativeState.excerpt,
            featuredImageCandidate: nativeState.featuredImageId ? null : nativeState.featuredImageCandidate,
            featuredImageMode: nativeState.featuredImageId ? 'keep' : (nativeState.featuredImageCandidate ? 'candidate' : 'keep'),
            postStatus: nativeState.postStatus,
            tags: nativeState.tags
        });
    }

    function updatePublishPanelToggle(context) {
        var mode = context && context.publishPanelDraft ? context.publishPanelDraft.mode : 'publish';
        var label = mode === 'update' ? getString('updatePost') : getString('publishPost');
        var $button = context && context.publishPanelButton ? context.publishPanelButton : $();

        if (!$button.length) {
            return;
        }

        $button.attr('aria-label', label);
        $button.attr('title', label);
    }

    function updatePublishPanelDraft(context, updates) {
        var current = context && context.publishPanelDraft ? context.publishPanelDraft : createPublishPanelDraft({});
        var next = createPublishPanelDraft({
            categories: Object.prototype.hasOwnProperty.call(updates, 'categories') ? updates.categories : current.categories,
            excerpt: Object.prototype.hasOwnProperty.call(updates, 'excerpt') ? updates.excerpt : current.excerpt,
            featuredImageCandidate: Object.prototype.hasOwnProperty.call(updates, 'featuredImageCandidate') ? updates.featuredImageCandidate : current.featuredImageCandidate,
            featuredImageMode: Object.prototype.hasOwnProperty.call(updates, 'featuredImageMode') ? updates.featuredImageMode : current.featuredImageMode,
            postStatus: current.mode === 'update' ? 'publish' : '',
            publishAfterPreview: Object.prototype.hasOwnProperty.call(updates, 'publishAfterPreview') ? updates.publishAfterPreview : current.publishAfterPreview,
            tags: Object.prototype.hasOwnProperty.call(updates, 'tags') ? updates.tags : current.tags
        });

        next.mode = current.mode;
        context.publishPanelDraft = next;

        return next;
    }

    function applyPublishPanelDraft(context) {
        var nativeState = context && context.publishPanelNativeState ? context.publishPanelNativeState : readNativePublishState(context);
        var nextState = applyPublishPanelDraftToNativeState(nativeState, context.publishPanelDraft || {});
        var writer = context && context.nativePublishFieldWriter ? context.nativePublishFieldWriter : null;
        var featuredImageApi = window.wp && window.wp.media && window.wp.media.featuredImage ? window.wp.media.featuredImage : null;
        var draft = context && context.publishPanelDraft ? context.publishPanelDraft : createPublishPanelDraft({});

        if (typeof writer === 'function') {
            writer(nextState);
            return nextState;
        }

        if ($('#tax-input-post_tag').val) {
            $('#tax-input-post_tag').val(nextState.tagString);
        }

        if ($('#excerpt').val) {
            $('#excerpt').val(nextState.excerpt);
        }

        if ($('#easymde-featured-image-mode-field').val) {
            $('#easymde-featured-image-mode-field').val(draft.featuredImageMode || 'keep');
        }

        if ($('#easymde-featured-image-id-field').val) {
            $('#easymde-featured-image-id-field').val(
                draft.featuredImageCandidate && draft.featuredImageCandidate.id
                    ? String(draft.featuredImageCandidate.id)
                    : ''
            );
        }

        if ($('#easymde-featured-image-url-field').val) {
            $('#easymde-featured-image-url-field').val(
                draft.featuredImageCandidate && draft.featuredImageCandidate.url
                    ? String(draft.featuredImageCandidate.url)
                    : ''
            );
        }

        if (document.querySelectorAll) {
            Array.prototype.forEach.call(
                document.querySelectorAll('#categorychecklist input[type="checkbox"], #categorychecklist-pop input[type="checkbox"]'),
                function (input) {
                    input.checked = nextState.categories.indexOf(String(input.value || '')) !== -1;
                }
            );
        }

        if (featuredImageApi && typeof featuredImageApi.set === 'function') {
            featuredImageApi.set(nextState.featuredImageId > 0 ? nextState.featuredImageId : -1);
        } else if ($('#_thumbnail_id').val) {
            $('#_thumbnail_id').val(nextState.featuredImageId > 0 ? String(nextState.featuredImageId) : '-1');
        }

        return nextState;
    }

    function triggerNativePublish(context) {
        var submitter = context && context.nativePublishSubmitter ? context.nativePublishSubmitter : null;

        if (typeof submitter === 'function') {
            submitter();
            return;
        }

        if ($('#publish').length && !$('#publish').prop('disabled')) {
            $('#publish').trigger('click');
            return;
        }

        $('#post').trigger('submit');
    }

    function publishPreviewStorageKey(storage) {
        storage = storage || {};

        if (storage.siteKey && storage.userId !== undefined) {
            return 'easymde:publish-preview:' + storage.siteKey + ':' + storage.userId;
        }

        return '';
    }

    function rememberPublishPreviewRequest(context) {
        var key = publishPreviewStorageKey(context && context.storage ? context.storage : {});
        var postId = $('#post_ID').val ? String($('#post_ID').val() || '') : '';

        if (!key || !window.sessionStorage || typeof window.sessionStorage.setItem !== 'function') {
            return;
        }

        try {
            if (context && context.publishPanelDraft && context.publishPanelDraft.publishAfterPreview) {
                window.sessionStorage.setItem(key, JSON.stringify({ postId: postId }));
            } else {
                window.sessionStorage.removeItem(key);
            }
        } catch (error) {
            return;
        }
    }

    function clearPublishPreviewRequest(context) {
        var key = publishPreviewStorageKey(context && context.storage ? context.storage : {});

        if (!key || !window.sessionStorage || typeof window.sessionStorage.removeItem !== 'function') {
            return;
        }

        try {
            window.sessionStorage.removeItem(key);
        } catch (error) {
            return;
        }
    }

    function readPublishPreviewRequest(context) {
        var key = publishPreviewStorageKey(context && context.storage ? context.storage : {});
        var raw;

        if (!key || !window.sessionStorage || typeof window.sessionStorage.getItem !== 'function') {
            return null;
        }

        try {
            raw = window.sessionStorage.getItem(key);
        } catch (error) {
            return null;
        }

        if (!raw) {
            return null;
        }

        try {
            return JSON.parse(raw);
        } catch (error) {
            return null;
        }
    }

    function currentEditorPostId() {
        return $('#post_ID').val ? String($('#post_ID').val() || '') : '';
    }

    function hasNativePublishSuccessState(context) {
        if (context && typeof context.publishSuccessReader === 'function') {
            return !!context.publishSuccessReader();
        }

        return !!(
            (document.getElementById && document.getElementById('message'))
            || (document.querySelector && document.querySelector('.notice-success'))
        );
    }

    function findPublishPreviewUrl(context) {
        var finder = context && context.previewLinkFinder ? context.previewLinkFinder : null;
        var link;

        if (typeof finder === 'function') {
            return finder();
        }

        if (document.querySelector) {
            link = document.querySelector('#view-post-btn a, #preview-action a, #sample-permalink a');
            if (link && link.href) {
                return link.href;
            }
        }

        return '';
    }

    function consumePublishPreviewRequest(context) {
        var request = readPublishPreviewRequest(context);
        var currentPostId = currentEditorPostId();
        var url;
        var opened;

        if (!request || !request.postId) {
            return false;
        }

        if (request.postId !== currentPostId) {
            clearPublishPreviewRequest(context);
            return false;
        }

        if (!hasNativePublishSuccessState(context)) {
            clearPublishPreviewRequest(context);
            return false;
        }

        url = findPublishPreviewUrl(context);
        clearPublishPreviewRequest(context);

        if (!url) {
            if (context && context.flash) {
                showFlash(context.flash, 'info', getString('publishPreviewMissing'));
            }
            return false;
        }

        opened = window.open ? window.open(url, '_blank', 'noopener') : null;
        if (!opened && context && context.flash) {
            showFlash(context.flash, 'info', getString('publishPreviewBlocked'));
        }

        return !!opened;
    }

    function openFeaturedImagePicker(context) {
        var openPicker = context && context.featuredImagePickerOpen ? context.featuredImagePickerOpen : null;
        var frame;

        function setPublishPanelSuspended(suspended) {
            if (context && context.publishPanel && context.publishPanel.length) {
                context.publishPanel.toggleClass('easymde-publish-panel-suspended', !!suspended);
            }
        }

        if (typeof openPicker === 'function') {
            openPicker(function (selection) {
                setPublishPanelSuspended(false);
                if (selection) {
                    updatePublishPanelDraft(context, {
                        featuredImageCandidate: selection,
                        featuredImageMode: 'candidate'
                    });
                    renderPublishPanel(context);
                }
            });
            return;
        }

        if (!window.wp || !window.wp.media) {
            return;
        }

        setPublishPanelSuspended(true);
        frame = window.wp.media({
            title: getString('publishPanelChooseFeaturedImage'),
            library: { type: 'image' },
            multiple: false
        });

        frame.on('open', function () {
            if (frame.content && typeof frame.content.mode === 'function') {
                frame.content.mode('browse');
            }
        });

        frame.on('select', function () {
            var attachment = frame.state().get('selection').first().toJSON();
            updatePublishPanelDraft(context, {
                featuredImageCandidate: {
                    alt: attachment.alt || attachment.title || '',
                    id: attachment.id,
                    url: attachment.url
                },
                featuredImageMode: 'candidate'
            });
            renderPublishPanel(context);
        });

        frame.on('close', function () {
            setPublishPanelSuspended(false);
        });

        frame.open();
    }

    function ensurePublishPanelShell(context) {
        var $dialog;
        var $backdrop;
        var $shell;
        var $title;
        var $body;
        var $footer;
        var $cancel;
        var $confirm;

        if (context.publishPanel && context.publishPanel.length) {
            return context.publishPanel;
        }

        $dialog = $('<div class="easymde-publish-panel" hidden></div>');
        $backdrop = $('<div class="easymde-publish-panel-backdrop"></div>');
        $shell = $('<div class="easymde-publish-panel-shell" role="dialog" aria-modal="true"></div>');
        $title = $('<h2 class="easymde-publish-panel-title"></h2>');
        $body = $('<div class="easymde-publish-panel-body"></div>');
        $footer = $('<div class="easymde-publish-panel-footer"></div>');
        $cancel = $('<button type="button" class="button button-secondary"></button>').text(getString('cancel'));
        $confirm = $('<button type="button" class="button button-primary"></button>');

        context.publishPanel = $dialog;
        context.publishPanelTitle = $title;
        context.publishPanelBody = $body;
        context.publishPanelCancel = $cancel;
        context.publishPanelConfirm = $confirm;

        $cancel.on('click', function () {
            closePublishPanel(context);
        });

        $confirm.on('click', function () {
            rememberPublishPreviewRequest(context);
            applyPublishPanelDraft(context);
            closePublishPanel(context);
            triggerNativePublish(context);
        });

        $backdrop.on('click', function () {
            closePublishPanel(context);
        });

        $shell.on('click', function (event) {
            event.stopPropagation();
        });

        $footer.append($cancel, $confirm);
        $shell.append($title, $body, $footer);
        $dialog.append($backdrop, $shell);
        context.root.append($dialog);

        return $dialog;
    }

    function renderPublishPanel(context) {
        var draft = context && context.publishPanelDraft ? context.publishPanelDraft : createPublishPanelDraft({});
        var nativeState = context && context.publishPanelNativeState ? context.publishPanelNativeState : readNativePublishState(context);
        var previewState = applyPublishPanelDraftToNativeState(nativeState, draft);
        var title = draft.mode === 'update' ? getString('updatePostTitle') : getString('publishPostTitle');
        var confirmLabel = draft.mode === 'update' ? getString('updatePost') : getString('publishPost');
        var $tagsLabel;
        var $tagsInput;
        var $excerptLabel;
        var $excerptInput;
        var $categoryLabel;
        var $categoryList;
        var $previewToggleLabel;
        var $previewToggle;
        var $featuredSummary;
        var $featuredActions;
        var $useCandidateButton;
        var $chooseButton;
        var $clearButton;

        ensurePublishPanelShell(context);
        context.publishPanelTitle.text(title);
        context.publishPanelConfirm.text(confirmLabel);
        context.publishPanelBody.empty();
        context.publishPanelBody.append(
            $('<p class="easymde-publish-panel-summary"></p>').text(getString('publishPanelReadOnlyHelp'))
        );

        $tagsLabel = $('<label class="easymde-publish-panel-field"></label>');
        $tagsLabel.append(
            $('<span class="easymde-publish-panel-field-label"></span>').text(getString('publishPanelTags'))
        );
        $tagsInput = $('<input type="text" class="easymde-publish-panel-input">').val(previewState.tagString);
        $tagsInput.on('input', function () {
            updatePublishPanelDraft(context, { tags: normalizeTagList($(this).val()) });
        });
        $tagsLabel.append($tagsInput);

        $featuredSummary = $('<p class="easymde-publish-panel-summary"></p>').text(
            getString('publishPanelFeaturedImage') + ': ' + (
                draft.featuredImageMode === 'clear'
                    ? getString('publishPanelClearFeaturedImagePending')
                    : (draft.featuredImageMode === 'candidate' && draft.featuredImageCandidate
                        ? draft.featuredImageCandidate.url
                        : (nativeState.featuredImageId ? getString('publishPanelKeepCurrent') : getString('publishPanelEmpty')))
            )
        );
        $featuredActions = $('<div class="easymde-publish-panel-actions"></div>');
        if (nativeState.featuredImageCandidate) {
            $useCandidateButton = $('<button type="button" class="button button-secondary"></button>').text(getString('publishPanelUseFirstImage'));
            $useCandidateButton.on('click', function () {
                updatePublishPanelDraft(context, {
                    featuredImageCandidate: nativeState.featuredImageCandidate,
                    featuredImageMode: 'candidate'
                });
                renderPublishPanel(context);
            });
            $featuredActions.append($useCandidateButton);
        }
        $chooseButton = $('<button type="button" class="button button-secondary"></button>').text(getString('publishPanelChooseFeaturedImage'));
        $chooseButton.on('click', function () {
            openFeaturedImagePicker(context);
        });
        $clearButton = $('<button type="button" class="button button-secondary"></button>').text(getString('publishPanelClearFeaturedImage'));
        $clearButton.on('click', function () {
            updatePublishPanelDraft(context, {
                featuredImageCandidate: null,
                featuredImageMode: 'clear'
            });
            renderPublishPanel(context);
        });
        $featuredActions.append($chooseButton, $clearButton);

        $excerptLabel = $('<label class="easymde-publish-panel-field"></label>');
        $excerptLabel.append(
            $('<span class="easymde-publish-panel-field-label"></span>').text(getString('publishPanelExcerpt'))
        );
        $excerptInput = $('<textarea class="easymde-publish-panel-textarea"></textarea>').val(previewState.excerpt);
        $excerptInput.on('input', function () {
            updatePublishPanelDraft(context, { excerpt: $(this).val() });
        });
        $excerptLabel.append($excerptInput);

        $categoryLabel = $('<div class="easymde-publish-panel-field"></div>');
        $categoryLabel.append(
            $('<span class="easymde-publish-panel-field-label"></span>').text(getString('publishPanelCategories'))
        );
        $categoryList = $('<div class="easymde-publish-panel-category-list"></div>');
        (nativeState.categoryOptions || []).forEach(function (option) {
            var checked = previewState.categories.indexOf(String(option.id)) !== -1;
            var $optionLabel = $('<label class="easymde-publish-panel-checkbox"></label>');
            var $optionInput = $('<input type="checkbox">')
                .attr('value', option.id)
                .prop('checked', checked);

            $optionInput.on('change', function () {
                var values = [];

                $categoryList.find('input[type="checkbox"]:checked').each(function () {
                    values.push(String($(this).val() || ''));
                });

                updatePublishPanelDraft(context, { categories: normalizeCategoryIds(values) });
            });

            $optionLabel.append($optionInput, $('<span></span>').text(option.label || option.id));
            $categoryList.append($optionLabel);
        });
        if (!(nativeState.categoryOptions || []).length) {
            $categoryList.append(
                $('<p class="easymde-publish-panel-summary"></p>').text(getString('publishPanelEmpty'))
            );
        }
        $categoryLabel.append($categoryList);

        $previewToggleLabel = $('<label class="easymde-publish-panel-checkbox"></label>');
        $previewToggle = $('<input type="checkbox">').prop('checked', !!draft.publishAfterPreview);
        $previewToggle.on('change', function () {
            updatePublishPanelDraft(context, { publishAfterPreview: !!$(this).prop('checked') });
        });
        $previewToggleLabel.append($previewToggle, $('<span></span>').text(getString('publishPanelPreviewAfter')));

        context.publishPanelBody.append(
            $tagsLabel,
            $featuredSummary,
            $featuredActions,
            $excerptLabel,
            $categoryLabel,
            $previewToggleLabel
        );
        updatePublishPanelToggle(context);
    }

    function openPublishPanel(context) {
        context.publishPanelNativeState = readNativePublishState(context);
        context.publishPanelDraft = createPublishPanelDraft({
            categories: context.publishPanelNativeState.categories,
            excerpt: context.publishPanelNativeState.excerpt,
            featuredImageCandidate: context.publishPanelNativeState.featuredImageId ? null : context.publishPanelNativeState.featuredImageCandidate,
            featuredImageMode: context.publishPanelNativeState.featuredImageId ? 'keep' : (context.publishPanelNativeState.featuredImageCandidate ? 'candidate' : 'keep'),
            postStatus: context.publishPanelNativeState.postStatus,
            tags: context.publishPanelNativeState.tags
        });
        renderPublishPanel(context);
        context.publishPanel.prop('hidden', false);
        closePopovers();
        updatePublishPanelToggle(context);
    }

    function closePublishPanel(context) {
        if (!context || !context.publishPanel || !context.publishPanel.length) {
            return;
        }

        context.publishPanel.prop('hidden', true);

        if (context.publishPanelButton && context.publishPanelButton.length) {
            focusWithoutScrolling(context.publishPanelButton[0]);
        }
    }

    function createPublishPanelButton($container, context) {
        var $button = createUtilityButton(getString('publishPost'), 'dashicons-admin-post', 'easymde-toolbar-publish-toggle');

        context.publishPanelButton = $button;

        $button.on('mousedown', function (event) {
            event.preventDefault();
        });

        $button.on('click', function () {
            openPublishPanel(context);
        });

        $container.append($button);
        updatePublishPanelToggle(context);
    }

    function createSideActions($aside, context) {
        var sideCommands = getSurfaceCommands('side');

        $aside.empty();
        $aside.prop('hidden', !sideCommands.length);

        sideCommands.forEach(function (command) {
            $aside.append(createCommandButton(command, {
                compact: false,
                className: 'easymde-side-action',
                context: context
            }));
        });
    }

    function bindImmersiveModeShortcuts(context) {
        $(document).on('keydown.easymdeImmersive', function (event) {
            if (
                event.key === 'Escape'
                && context.publishPanel
                && context.publishPanel.length
                && context.publishPanel.prop('hidden') === false
            ) {
                event.preventDefault();
                closePublishPanel(context);
                return;
            }

            if (event.key !== 'Escape' || !context.root.hasClass('easymde-editor-immersive')) {
                return;
            }

            if ($(event.target).closest('.media-modal, .media-frame, .media-modal-backdrop').length) {
                return;
            }

            event.preventDefault();
            setImmersiveMode(context, false);
        });
    }

    function afterShellPaint(callback) {
        var fallbackTimer;
        var called = false;

        function run() {
            if (called) {
                return;
            }

            called = true;
            callback();
        }

        if (window.requestAnimationFrame) {
            // Prevent the initial preview from hanging if rAF is throttled or suspended.
            fallbackTimer = window.setTimeout(run, 120);
            window.requestAnimationFrame(function () {
                window.setTimeout(function () {
                    window.clearTimeout(fallbackTimer);
                    run();
                }, 0);
            });
            return;
        }

        window.setTimeout(run, 0);
    }

    function initEditor() {
        var $root = $('#easymde-editor');
        var $outlineRail = $('#easymde-outline-rail');
        var $source = $('#easymde-source');
        var $preview = $('#easymde-preview');
        var $divider = $('#easymde-divider');
        var $workspace = $root.find('.easymde-workspace');
        var $content = $('#postdivrich');
        var $toolbar = $('#easymde-toolbar');
        var $sideActions = $('#easymde-side-actions');
        var storage = window.EasyMDEDraftStorage.normalizeStorage(config, $root.data('post-id'));
        var initialMarkdown = null;
        var initialPreviewHydrated = false;
        var initialPreviewEnhancement = null;
        var editorChromeReady = false;
        var sourceChangedBeforeShell = false;
        var deferWechatPreload = false;
        var savedMarkdownFingerprint = String($root.attr('data-easymde-markdown-fingerprint') || '');
        var $flash;
        var $draftStatus;
        var context;

        if (!$root.length || !$source.length || !$preview.length) {
            return;
        }

        if (!$toolbar.length) {
            $toolbar = $root.find('.easymde-toolbar');
        }

        if (!$sideActions.length) {
            $sideActions = $root.find('.easymde-side-actions');
        }

        if ($content.length) {
            $content.addClass('easymde-native-editor-hidden');
        }

        if (
            (
                $preview.attr('data-easymde-initial-preview') === '1'
                || $preview.attr('data-easymde-initial-preview-provisional') === '1'
            )
            && hasLocalDraft(storage, savedMarkdownFingerprint)
        ) {
            setPreviewPending($preview, true);
        } else {
            initialPreviewHydrated = hydrateInitialPreview($preview, '', {
                deferEnhancement: function (callback) {
                    initialPreviewEnhancement = callback;
                }
            });
        }

        function refreshPreview(options) {
            updatePreview($preview, $source.val(), options || { immediate: true });
        }

        context = {
            activeOutlineIndex: -1,
            outlineOpen: false,
            outlineRail: $outlineRail,
            root: $root,
            storage: storage,
            textarea: $source[0],
            preview: $preview,
            workspace: $workspace,
            workspaceNode: $workspace.length ? $workspace[0] : null,
            divider: $divider,
            dividerNode: $divider.length ? $divider[0] : null,
            refreshPreview: refreshPreview,
            flash: null
        };

        initializeWorkspaceLayout(context);

        function initializeEditorChrome() {
            if (editorChromeReady) {
                return;
            }

            editorChromeReady = true;
            $flash = createFlash($toolbar);
            context.flash = $flash;
            $draftStatus = createToolbar($toolbar, context);
            createSideActions($sideActions, context);
            bindScrollSync($source[0], $preview[0]);
            bindShortcuts($root, $source[0], context);
            bindImmersiveModeShortcuts(context);
            $root.attr('data-easymde-shell-ready', '1');
        }

        initializeEditorChrome();
        bindLazyImagePasteUpload($source[0], $root, $flash);

        $source.on('input', function () {
            if (initialMarkdown === null) {
                sourceChangedBeforeShell = true;
            }

            mirrorToPostContent(this.value);
            updatePreview($preview, this.value);
            scheduleWorkspaceDerivedStateUpdate(context, this.value);

            if (!config.features || config.features.localDrafts !== false) {
                window.clearTimeout(draftTimer);
                draftTimer = window.setTimeout(function () {
                    window.EasyMDEDraftStorage.write(storage, $source.val());
                    if ($draftStatus && $draftStatus.length) {
                        $draftStatus.text(getString('draftSaved') + ' ' + window.EasyMDEDraftStorage.formatTime(Date.now()));
                    }
                }, 500);
            }
        });

        $('#post').on('submit', function () {
            mirrorToPostContent($source.val());
        });

        afterShellPaint(function () {
            var shellMarkdown = $source.val();

            initialMarkdown = shellMarkdown;
            syncMarkdownFields(shellMarkdown);
            applyWorkspaceDerivedState(context, shellMarkdown);

            if (!initialPreviewHydrated) {
                updatePreview($preview, shellMarkdown, { immediate: true });
            }

            if (initialPreviewEnhancement) {
                if (!sourceChangedBeforeShell) {
                    initialPreviewEnhancement(shellMarkdown);
                    deferWechatPreload = true;
                }
                initialPreviewEnhancement = null;
            }

            if (deferWechatPreload) {
                afterPreviewIdle(preloadWechatExporter);
            } else {
                preloadWechatExporter();
            }

            if (!config.features || config.features.localDrafts !== false) {
                afterPreviewIdle(function () {
                    if (!sourceChangedBeforeShell && $source.val() === initialMarkdown) {
                        createDraftNotice($root, $source[0], storage, $flash);
                    }
                });
            }

            afterPreviewIdle(function () {
                consumePublishPreviewRequest(context);
            });
        });
    }

    if (config.testHooks && window.EasyMDETestHooks) {
        window.EasyMDETestHooks.afterShellPaint = afterShellPaint;
        window.EasyMDETestHooks.clampWorkspaceRatio = clampWorkspaceRatio;
        window.EasyMDETestHooks.copyWechat = copyWechat;
        window.EasyMDETestHooks.bindLazyImagePasteUpload = bindLazyImagePasteUpload;
        window.EasyMDETestHooks.handleWorkspaceDividerKey = handleWorkspaceDividerKey;
        window.EasyMDETestHooks.hydrateInitialPreview = hydrateInitialPreview;
        window.EasyMDETestHooks.initializeWorkspaceLayout = initializeWorkspaceLayout;
        window.EasyMDETestHooks.ensureImagePasteBound = ensureImagePasteBound;
        window.EasyMDETestHooks.clearPublishPreviewRequest = clearPublishPreviewRequest;
        window.EasyMDETestHooks.closePublishPanel = closePublishPanel;
        window.EasyMDETestHooks.applyPublishPanelDraft = applyPublishPanelDraft;
        window.EasyMDETestHooks.confirmPublishPanel = function (context) {
            rememberPublishPreviewRequest(context);
            applyPublishPanelDraft(context);
            closePublishPanel(context);
            triggerNativePublish(context);
        };
        window.EasyMDETestHooks.consumePublishPreviewRequest = consumePublishPreviewRequest;
        window.EasyMDETestHooks.openPublishPanel = openPublishPanel;
        window.EasyMDETestHooks.openMediaPicker = openMediaPicker;
        window.EasyMDETestHooks.readPublishPanelDraftFromNative = readPublishPanelDraftFromNative;
        window.EasyMDETestHooks.readPublishPreviewRequest = readPublishPreviewRequest;
        window.EasyMDETestHooks.rememberPublishPreviewRequest = rememberPublishPreviewRequest;
        window.EasyMDETestHooks.updatePublishPanelDraft = updatePublishPanelDraft;
        window.EasyMDETestHooks.readStoredWorkspaceRatio = readStoredWorkspaceRatio;
        window.EasyMDETestHooks.setWorkspaceRatio = setWorkspaceRatio;
        window.EasyMDETestHooks.showFlash = showFlash;
        window.EasyMDETestHooks.toggleImmersiveTitleHost = toggleImmersiveTitleHost;
        window.EasyMDETestHooks.updatePreview = updatePreview;
        window.EasyMDETestHooks.writeStoredWorkspaceRatio = writeStoredWorkspaceRatio;
    }

    function startEditorWhenReady() {
        if (document.getElementById && document.getElementById('easymde-editor')) {
            initEditor();
            return;
        }

        $(initEditor);
    }

    startEditorWhenReady();
})(jQuery, window, document);
