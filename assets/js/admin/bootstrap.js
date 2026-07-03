(function ($, window, document) {
    'use strict';

    var config = window.EasyMDEConfig || {};
    var themeOptions = config.themeOptions || {};
    var fontOptions = themeOptions.fontOptions || {};
    var editorStateTools = window.EasyMDEEditorState || {};
    var themeManager = window.EasyMDEThemeManager || {};
    var commandTools = window.EasyMDECommands || {};
    var previewClient = window.EasyMDEPreviewClient || {};
    var toolbarTools = window.EasyMDEToolbar || {};
    var detectMacPlatform = editorStateTools.detectMacPlatform || detectMacPlatform;
    var normalizeRenderState = themeManager.normalizeRenderState || normalizeRenderState;
    var findById = editorStateTools.findById || findById;
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
    var draftTimer = null;
    var syncLock = false;
    var flashTimer = null;
    var commandMap = buildCommandMap(config.commands || []);
    var isMac = detectMacPlatform();
    var openPopovers = [];
    var getCommand = commandTools.getCommand ? function (id) {
        return commandTools.getCommand(commandMap, id);
    } : getCommand;
    var getSurfaceCommands = commandTools.getSurfaceCommands ? function (surface) {
        return commandTools.getSurfaceCommands(commandMap, surface);
    } : getSurfaceCommands;
    var getGroupCommands = commandTools.getGroupCommands ? function (surface, group) {
        return commandTools.getGroupCommands(commandMap, surface, group);
    } : getGroupCommands;
    var getShortcutForCommand = commandTools.getShortcutForCommand ? function (commandId) {
        return commandTools.getShortcutForCommand(config.shortcuts || {}, commandId, isMac);
    } : getShortcutForCommand;
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

    function getCommand(id) {
        return commandMap[id] || null;
    }

    function getSurfaceCommands(surface) {
        return Object.keys(commandMap).map(function (id) {
            return commandMap[id];
        }).filter(function (command) {
            return command.surface === surface;
        });
    }

    function getGroupCommands(surface, group) {
        return getSurfaceCommands(surface).filter(function (command) {
            return command.group === group;
        });
    }

    function getShortcutForCommand(commandId) {
        var shortcuts = config.shortcuts || {};
        var shortcut = shortcuts[commandId] || {};

        return isMac ? (shortcut.mac || '') : (shortcut.win || '');
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

    function registerPopover($button, $panel) {
        openPopovers.push({
            button: $button,
            panel: $panel
        });

        $button.on('mousedown', function (event) {
            event.preventDefault();
        });

        $button.on('click', function (event) {
            event.preventDefault();
            event.stopPropagation();

            var isOpen = !$panel.prop('hidden');
            closePopovers();
            $panel.prop('hidden', isOpen);
            $button.toggleClass('is-active', !isOpen);
        });

        $panel.on('click', function (event) {
            event.stopPropagation();
        });
    }

    function closePopovers() {
        openPopovers.forEach(function (popover) {
            popover.panel.prop('hidden', true);
            popover.button.removeClass('is-active');
        });
    }

    function createMenuAnchor(extraClass) {
        return $('<div class="easymde-toolbar-popover-anchor"></div>').addClass(extraClass || '');
    }

    function createHeadingMenu($container, textarea) {
        var headingCommands = getSurfaceCommands('heading-menu');

        if (!headingCommands.length) {
            return;
        }

        var $anchor = createMenuAnchor('easymde-toolbar-popover-headings');
        var $button = $('<button type="button" class="easymde-toolbar-button easymde-toolbar-button-menu easymde-toolbar-button-compact"></button>');
        var $panel = $('<div class="easymde-toolbar-popover" hidden></div>');

        $button.attr('title', getString('headings'));
        $button.attr('aria-label', getString('headings'));
        $button.append(
            $('<span class="easymde-toolbar-text-icon" aria-hidden="true"></span>').text('H'),
            $('<span class="dashicons dashicons-arrow-down-alt2" aria-hidden="true"></span>')
        );

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

        registerPopover($button, $panel);
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
        $('#easymde-custom-font-select').val(renderState.customFont || 'optima');
        $('#easymde-windows-font-select').val(renderState.windowsFont || 'microsoft-yahei');
        $('#easymde-apple-font-select').val(renderState.appleFont || 'pingfang-sc-light');
        $('#easymde-serif-font-select').val(renderState.serifFont || 'yes');
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

    function applyCodeThemeLink() {
        var codeTheme = findById(themeOptions.codeThemes || [], renderState.codeTheme);
        var href = codeTheme && codeTheme.cssUrl ? codeTheme.cssUrl : '';
        var link = document.getElementById('easymde-highlight-theme-css');

        if (!href) {
            return;
        }

        if (!link) {
            link = document.createElement('link');
            link.id = 'easymde-highlight-theme-css';
            link.rel = 'stylesheet';
            document.head.appendChild(link);
        }

        if (link.href !== href) {
            link.href = href;
        }
    }

    function applyArticleThemeLink() {
        var markdownTheme = renderState.markdownTheme === 'custom' ? null : getMarkdownTheme(renderState.markdownTheme);
        var href = markdownTheme && markdownTheme.cssUrl ? markdownTheme.cssUrl : '';
        var link = document.getElementById('easymde-article-theme-css');

        if (!href) {
            return;
        }

        if (!link) {
            link = document.createElement('link');
            link.id = 'easymde-article-theme-css';
            link.rel = 'stylesheet';
            document.head.appendChild(link);
        }

        if (link.href !== href) {
            link.href = href;
        }
    }

    function applyRenderState($preview) {
        var preview = $preview[0];
        var markdownClass = renderState.markdownTheme === 'custom'
            ? 'easymde-markdown-theme-custom'
            : 'easymde-markdown-theme-' + renderState.markdownTheme;
        var fontStack = buildFontStack();

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

        syncThemeFields();
        syncFontControls();
        applyArticleThemeLink();
        applyCodeThemeLink();
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
        var themeControl = createSelectControl(getString('articleTheme'), 'easymde-theme-select');
        var codeControl = createSelectControl(getString('codeTheme'), 'easymde-code-theme-select');
        var $macLabel = $('<label class="easymde-toolbar-check"></label>');
        var $macToggle = $('<input type="checkbox">').prop('checked', !!renderState.codeMacStyle);
        var $customToggle = $('<button type="button" class="button button-secondary easymde-custom-css-toggle"></button>').text(getString('customCss'));
        var $customPanel = $('<div class="easymde-custom-css-panel" hidden></div>');
        var $name = $('<input type="text" class="regular-text easymde-custom-css-name">').attr('placeholder', getString('cssName'));
        var $code = $('<textarea class="easymde-custom-css-code" spellcheck="false"></textarea>');
        var $save = $('<button type="button" class="button button-primary"></button>').text(getString('saveCss'));
        var $status = $('<span class="easymde-custom-css-status" aria-live="polite"></span>');

        $button.attr('title', getString('appearance'));
        $button.attr('aria-label', getString('appearance'));
        $button.append(
            $('<span class="dashicons dashicons-admin-customizer" aria-hidden="true"></span>'),
            $('<span class="dashicons dashicons-arrow-down-alt2" aria-hidden="true"></span>')
        );

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
        });

        $macToggle.on('change', function () {
            renderState.codeMacStyle = !!this.checked;
            applyRenderState($preview);
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

        registerPopover($button, $panel);
        $anchor.append($button, $panel);
        $container.append($anchor);
    }

    function createFontMenu($container, $preview) {
        var $anchor = createMenuAnchor('easymde-toolbar-popover-font');
        var $button = $('<button type="button" class="easymde-toolbar-button easymde-toolbar-button-menu easymde-toolbar-button-compact"></button>');
        var $panel = $('<div class="easymde-toolbar-popover easymde-toolbar-popover-font-panel" hidden></div>');
        var customControl = createSelectControl(getString('customFont'), 'easymde-custom-font-select');
        var windowsControl = createSelectControl(getString('windowsFont'), 'easymde-windows-font-select');
        var appleControl = createSelectControl(getString('appleFont'), 'easymde-apple-font-select');
        var serifControl = createSelectControl(getString('serifFont'), 'easymde-serif-font-select');
        var controls = [
            [customControl, 'customFonts', 'customFont'],
            [windowsControl, 'windowsFonts', 'windowsFont'],
            [appleControl, 'appleFonts', 'appleFont'],
            [serifControl, 'serifOptions', 'serifFont']
        ];

        if (!getFontGroup('customFonts').length) {
            return;
        }

        $button.attr('title', getString('font'));
        $button.attr('aria-label', getString('font'));
        $button.append(
            $('<span class="easymde-toolbar-text-icon easymde-font-glyph" aria-hidden="true"></span>').text('A'),
            $('<span class="dashicons dashicons-arrow-down-alt2" aria-hidden="true"></span>')
        );

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

        registerPopover($button, $panel);
        $anchor.append($button, $panel);
        $container.append($anchor);
    }

    function createThemeToggleButton($container, $root, refreshPreview) {
        if (!window.EasyMDEEnhancements || !config.features || config.features.darkMode === false) {
            return;
        }

        var $button = $('<button type="button" class="easymde-toolbar-button easymde-toolbar-button-compact"></button>');

        function updateState() {
            var isDark = $root.hasClass('easymde-theme-dark');

            $button.empty();
            $button.toggleClass('is-active', isDark);
            $button.attr('title', isDark ? getString('lightMode') : getString('darkMode'));
            $button.attr('aria-label', isDark ? getString('lightMode') : getString('darkMode'));
            $button.append($('<span class="dashicons dashicons-lightbulb" aria-hidden="true"></span>'));
        }

        $button.on('click', function () {
            window.EasyMDEEnhancements.toggleTheme($root[0], config);
            updateState();
            refreshPreview();
        });

        updateState();
        $container.append($button);
    }

    function createFlash($root) {
        var $flash = $('<div class="easymde-editor-flash" hidden aria-live="polite"></div>');

        $root.find('.easymde-toolbar').after($flash);

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

    function createDraftStatus($toolbar) {
        var $status = $('<span class="easymde-draft-status" aria-live="polite"></span>');
        $toolbar.find('.easymde-toolbar-section-secondary').append($status);

        return $status;
    }

    function mirrorToPostContent(markdown) {
        var editor = $('#content');
        var markdownField = $('#easymde-markdown-field');

        markdownField.val(markdown);
        editor.val(markdown);
        syncThemeFields();
    }

    function previewFallback(markdown) {
        if (!markdown.trim()) {
            return '<p class="easymde-preview-empty">' + escapeHtml(getString('previewEmpty')) + '</p>';
        }

        return '<pre class="easymde-preview-fallback">' + escapeHtml(markdown) + '</pre>';
    }

    function enhancePreview($preview) {
        if (window.EasyMDEEnhancements) {
            window.EasyMDEEnhancements.enhance($preview[0], config);
        }
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

        if (!$root.length || enabled === isImmersive) {
            return;
        }

        scrollState = captureEditorScrollState(context);
        closePopovers();

        if (enabled) {
            context.immersiveWindowScroll = captureWindowScroll();
        }

        $root.toggleClass('easymde-editor-immersive', enabled);
        $('html, body').toggleClass('easymde-immersive-active', enabled);
        updateImmersiveToggle(context);

        window.requestAnimationFrame(function () {
            restoreEditorScrollState(context, scrollState);

            if (!enabled && context.immersiveWindowScroll) {
                window.scrollTo(context.immersiveWindowScroll.x, context.immersiveWindowScroll.y);
                context.immersiveWindowScroll = null;
            }

            focusWithoutScrolling(context.textarea);
        });
    }

    function updatePreview($preview, markdown) {
        var previewNode = $preview[0];

        function finishPreviewUpdate(scrollState) {
            applyRenderState($preview);
            restorePreviewScroll(previewNode, scrollState);
        }

        window.clearTimeout(previewTimer);
        previewTimer = window.setTimeout(function () {
            var scrollState;

            if (!markdown.trim()) {
                scrollState = capturePreviewScroll(previewNode);
                $preview.html('<p class="easymde-preview-empty">' + escapeHtml(getString('previewEmpty')) + '</p>');
                finishPreviewUpdate(scrollState);
                return;
            }

            if (!window.wp || !window.wp.apiFetch || !config.restUrl) {
                scrollState = capturePreviewScroll(previewNode);
                $preview.html(previewFallback(markdown));
                finishPreviewUpdate(scrollState);
                enhancePreview($preview);
                restorePreviewScroll(previewNode, scrollState);
                return;
            }

            window.wp.apiFetch({
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
            }).then(function (response) {
                scrollState = capturePreviewScroll(previewNode);
                $preview.html(response.html || previewFallback(markdown));
                finishPreviewUpdate(scrollState);
                enhancePreview($preview);
                restorePreviewScroll(previewNode, scrollState);
            }).catch(function () {
                scrollState = capturePreviewScroll(previewNode);
                $preview.html('<p class="easymde-preview-error">' + escapeHtml(getString('previewError')) + '</p>');
                finishPreviewUpdate(scrollState);
            });
        }, 180);
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

        if (isMac) {
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

            Object.keys(commandMap).some(function (commandId) {
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
            window.EasyMDEMediaPicker.open(textarea, {
                title: getString('insertMedia'),
                altText: getString('mediaAltText'),
                defaultAlt: getString('mediaDefaultAlt'),
                insertAround: insertAround,
                applyTextChange: applyTextChange
            });
            break;
        case 'savePost':
            triggerSavePost();
            break;
        case 'copyWechat':
            window.EasyMDEWechatExporter.copy(context, {
                getString: getString,
                showFlash: showFlash
            });
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
        var exportCommands = getGroupCommands('main', 'export');

        $toolbar.empty().append($main, $secondary);

        getGroupCommands('main', 'format').forEach(function (command) {
            $main.append(createCommandButton(command, { compact: true, context: context }));
        });

        createHeadingMenu($main, context.textarea);

        if (getGroupCommands('main', 'block').length) {
            $main.append($('<span class="easymde-toolbar-divider" aria-hidden="true"></span>'));
            getGroupCommands('main', 'block').forEach(function (command) {
                $main.append(createCommandButton(command, { compact: true, context: context }));
            });
        }

        if (getGroupCommands('main', 'insert').length) {
            $main.append($('<span class="easymde-toolbar-divider" aria-hidden="true"></span>'));
            getGroupCommands('main', 'insert').forEach(function (command) {
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

        createThemeToggleButton($secondary, context.root, context.refreshPreview);
        createImmersiveToggleButton($secondary, context);
        createFontMenu($secondary, context.preview);
        createAppearanceMenu($secondary, context.root, context.preview, context.refreshPreview);
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

    function initEditor() {
        var $root = $('#easymde-editor');
        var $source = $('#easymde-source');
        var $preview = $('#easymde-preview');
        var $content = $('#postdivrich');
        var $toolbar = $root.find('.easymde-toolbar');
        var $sideActions = $root.find('.easymde-side-actions');
        var storage = window.EasyMDEDraftStorage.normalizeStorage(config, $root.data('post-id'));
        var $flash;
        var $draftStatus;
        var context;

        if (!$root.length || !$source.length || !$preview.length) {
            return;
        }

        if ($content.length) {
            $content.addClass('easymde-native-editor-hidden');
        }

        if (window.EasyMDEEnhancements) {
            window.EasyMDEEnhancements.initTheme($root[0], config);
        }

        function refreshPreview() {
            updatePreview($preview, $source.val());
        }

        $flash = createFlash($root);

        context = {
            root: $root,
            textarea: $source[0],
            preview: $preview,
            refreshPreview: refreshPreview,
            flash: $flash
        };

        createToolbar($toolbar, context);
        $draftStatus = createDraftStatus($toolbar);
        createSideActions($sideActions, context);
        createDraftNotice($root, $source[0], storage, $flash);
        bindScrollSync($source[0], $preview[0]);
        bindShortcuts($root, $source[0], context);
        bindImmersiveModeShortcuts(context);

        $source.on('input', function () {
            mirrorToPostContent(this.value);
            updatePreview($preview, this.value);

            if (!config.features || config.features.localDrafts !== false) {
                window.clearTimeout(draftTimer);
                draftTimer = window.setTimeout(function () {
                    window.EasyMDEDraftStorage.write(storage, $source.val());
                    $draftStatus.text(getString('draftSaved') + ' ' + window.EasyMDEDraftStorage.formatTime(Date.now()));
                }, 500);
            }
        });

        $('#post').on('submit', function () {
            mirrorToPostContent($source.val());
        });

        mirrorToPostContent($source.val());
        updatePreview($preview, $source.val());
    }

    $(initEditor);
})(jQuery, window, document);
