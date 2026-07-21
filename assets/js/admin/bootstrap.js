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
    var previewRevision = 0;
    var previewAbortController = null;
    var previewRequestRevision = null;
    var normalPreviewGeneration = 0;
    var normalPreviewNode = null;
    var reactPreviewRequestSession = null;
    var reactPreviewNode = null;
    var reactPreviewSessionFailed = false;
    var imagePasteLoadPromise = null;
    var mediaPickerLoadPromise = null;
    var wechatExporterLoadPromise = null;
    var activePreviewFeatures = normalizePreviewFeatures(config.features || {});
    var draftTimer = null;
    var localDraftsEnabled = !(config.features && config.features.localDrafts === false);
    var syncLock = false;
    var flashTimer = null;
    var commandMap = null;
    var commandList = null;
    var commandSurfaceCache = {};
    var commandGroupCache = {};
    var isMac = null;
    var openPopovers = [];
    var fontControls = null;
    var reactFontControlsSession = null;
    var reactFontPreviewNode = null;
    var reactAppearanceSession = null;
    var reactAppearancePreviewNode = null;
    var revisionPreviewRevision = 0;
    var scrollSyncBindingId = 0;

    function readNativeCategoryOptions(documentRef, configuredOptions) {
        var doc = documentRef || document;
        var inputs = doc.querySelectorAll('#categorychecklist input[type="checkbox"]');
        var configuredById = (Array.isArray(configuredOptions) ? configuredOptions : []).reduce(function (result, option) {
            var id = String(option && option.id || '');

            if (id) {
                result[id] = option;
            }
            return result;
        }, Object.create(null));

        return Array.prototype.map.call(inputs, function (input) {
            var id = String(input.value || '');
            var configured = configuredById[id] || null;
            var item = input.closest ? input.closest('li') : null;
            var parentList = item ? item.parentElement : null;
            var parentItem = parentList
                && parentList.classList
                && parentList.classList.contains('children')
                && parentList.closest
                ? parentList.closest('li')
                : null;
            var parentInput = parentItem && parentItem.querySelector
                ? parentItem.querySelector(':scope > label > input[type="checkbox"]')
                : null;
            var hasChildren = !!(item && Array.prototype.some.call(item.children || [], function (child) {
                return child.classList && child.classList.contains('children');
            }));

            return {
                id: id,
                label: input.parentNode && input.parentNode.textContent
                    ? input.parentNode.textContent.replace(/\s+/g, ' ').trim()
                    : id,
                parentId: configured ? String(configured.parentId || '') : (parentInput ? String(parentInput.value || '') : ''),
                hasChildren: configured ? !!configured.hasChildren : hasChildren
            };
        });
    }

    function readNativePublishVisibility(documentRef) {
        var doc = documentRef || document;
        var selected = doc.querySelector('#post-visibility-select input[name="visibility"]:checked');
        var visibility = selected && ['public', 'password', 'private'].indexOf(selected.value) !== -1
            ? selected.value
            : 'public';
        var password = doc.querySelector('#post_password');
        var sticky = doc.querySelector('#sticky');

        return {
            visibility: visibility,
            password: visibility === 'password' && password ? String(password.value || '') : '',
            sticky: visibility === 'public' && !!(sticky && sticky.checked)
        };
    }

    function getNativePublishCapabilities(documentRef) {
        var doc = documentRef || document;

        return {
            categories: doc.querySelectorAll('#categorychecklist input[type="checkbox"]').length > 0,
            excerpt: !!doc.querySelector('#excerpt'),
            featuredImage: !!doc.querySelector('#_thumbnail_id'),
            sticky: !!doc.querySelector('#sticky'),
            tags: !!doc.querySelector('#tax-input-post_tag'),
            visibility: !!(
                doc.querySelector('#visibility-radio-public')
                && doc.querySelector('#visibility-radio-password')
                && doc.querySelector('#visibility-radio-private')
                && doc.querySelector('#post_password')
            )
        };
    }

    function preflightNativePublish(draft, documentRef) {
        var doc = documentRef || document;
        var capabilities = getNativePublishCapabilities(doc);
        var expected = draft && draft.capabilities ? draft.capabilities : {};
        var capabilityNames = ['categories', 'excerpt', 'featuredImage', 'sticky', 'tags', 'visibility'];
        var expectedControlsPresent = capabilityNames.every(function (name) {
            return expected[name] !== true || capabilities[name] === true;
        });

        return {
            capabilities: capabilities,
            ok: expectedControlsPresent && !!doc.querySelector('#publish')
        };
    }

    function getSessionStorage() {
        try {
            return window.sessionStorage || null;
        } catch (error) {
            return null;
        }
    }

    function applyNativePublishVisibility(draft, documentRef) {
        var doc = documentRef || document;
        var visibility = ['public', 'password', 'private'].indexOf(String(draft && draft.visibility || '')) !== -1
            ? String(draft.visibility)
            : 'public';
        var publicInput = doc.querySelector('#visibility-radio-public');
        var passwordInput = doc.querySelector('#visibility-radio-password');
        var privateInput = doc.querySelector('#visibility-radio-private');
        var password = doc.querySelector('#post_password');
        var sticky = doc.querySelector('#sticky');

        if (!publicInput || !passwordInput || !privateInput || !password) {
            return false;
        }

        publicInput.checked = visibility === 'public';
        passwordInput.checked = visibility === 'password';
        privateInput.checked = visibility === 'private';
        password.value = visibility === 'password' ? String(draft.password || '') : '';
        if (sticky) {
            sticky.checked = visibility === 'public' && !!draft.sticky;
        }

        return true;
    }

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
            dispatchNativeInput: dispatchNativeInput,
            focusWithoutScrolling: focusWithoutScrolling,
            restoreScrollPosition: restoreScrollPosition
        };
    }

    function dispatchNativeInput(field) {
        field.dispatchEvent(new window.Event('input', { bubbles: true }));
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

    function persistCustomCss(input) {
        if (!window.wp || !window.wp.apiFetch || !config.customCssUrl) {
            return Promise.reject(new Error(getString('cssSaveFailed') || 'CSS save failed.'));
        }

        input = input || {};
        return window.wp.apiFetch({
            url: config.customCssUrl,
            method: 'POST',
            headers: {
                'X-WP-Nonce': config.nonce
            },
            data: {
                id: String(input.id || ''),
                name: String(input.name || ''),
                css: String(input.css || '')
            }
        }).then(function (response) {
            var library = response && response.customCss;
            var item = response && response.item;
            var validItem = item
                && typeof item.id === 'string'
                && /^[a-z0-9_-]+$/.test(item.id)
                && typeof item.name === 'string'
                && typeof item.css === 'string'
                && item.css.length <= 30000
                && typeof item.scopedCss === 'string'
                && item.scopedCss.length <= 250000;
            var validLibrary = Array.isArray(library) && library.every(function (entry) {
                return entry
                    && typeof entry.id === 'string'
                    && /^[a-z0-9_-]+$/.test(entry.id)
                    && typeof entry.name === 'string'
                    && typeof entry.css === 'string'
                    && entry.css.length <= 30000
                    && typeof entry.scopedCss === 'string'
                    && entry.scopedCss.length <= 250000;
            });

            if (!validItem || !validLibrary) {
                throw new Error('custom-css-response-invalid');
            }
            customCssLibrary = response.customCss || customCssLibrary;
            renderState.markdownTheme = 'custom';
            renderState.customCssId = response.item.id;
            renderState.customCss = response.item.css || '';
            renderState.scopedCustomCss = response.item.scopedCss || '';
            themeOptions.state = renderState;

            return response;
        });
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
        var selectionDirection = textarea.selectionDirection;
        var windowScrollX = window.pageXOffset;
        var windowScrollY = window.pageYOffset;

        textarea.value = value;
        focusWithoutScrolling(textarea);

        if (typeof selectionStart === 'number' && typeof selectionEnd === 'number') {
            textarea.setSelectionRange(selectionStart, selectionEnd, selectionDirection || 'none');
        }

        restoreScrollPosition(textarea, scrollTop, scrollLeft);
        window.scrollTo(windowScrollX, windowScrollY);
        dispatchNativeInput(textarea);
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

    function triggerSavePost(beforeNavigation) {
        var $button = $('#save-post');

        if ($button.length && !$button.prop('disabled')) {
            $button.trigger('click');
            return;
        }

        $button = $('#publish');
        if ($button.length && !$button.prop('disabled')) {
            if (typeof beforeNavigation === 'function') {
                beforeNavigation();
            }
            $button.trigger('click');
            return;
        }

        if (typeof beforeNavigation === 'function') {
            beforeNavigation();
        }
        $('#post').trigger('submit');
    }

    var pendingCrossDocumentTransitionCleanup = null;

    function skipNextCrossDocumentViewTransition() {
        var cleanupTimer = null;
        var active = true;

        function cleanup() {
            if (!active) {
                return;
            }

            active = false;
            window.removeEventListener('pageswap', handlePageSwap);
            if (cleanupTimer !== null) {
                window.clearTimeout(cleanupTimer);
                cleanupTimer = null;
            }
            if (pendingCrossDocumentTransitionCleanup === cleanup) {
                pendingCrossDocumentTransitionCleanup = null;
            }
        }

        function handlePageSwap(event) {
            cleanup();
            if (
                event
                && event.viewTransition
                && typeof event.viewTransition.skipTransition === 'function'
            ) {
                event.viewTransition.skipTransition();
            }
        }

        if (
            typeof window.addEventListener !== 'function'
            || typeof window.removeEventListener !== 'function'
        ) {
            return function () {};
        }

        if (pendingCrossDocumentTransitionCleanup) {
            pendingCrossDocumentTransitionCleanup();
        }

        window.addEventListener('pageswap', handlePageSwap);
        cleanupTimer = window.setTimeout(cleanup, 15000);
        pendingCrossDocumentTransitionCleanup = cleanup;
        return cleanup;
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
        if (reactFontControlsSession && typeof reactFontControlsSession.close === 'function') {
            reactFontControlsSession.close();
        }
        if (reactAppearanceSession && typeof reactAppearanceSession.close === 'function') {
            reactAppearanceSession.close();
        }
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
        var nextState;

        if (!defaults) {
            return;
        }

        nextState = {
            customFont: defaults.customFont || renderState.customFont,
            windowsFont: defaults.windowsFont || renderState.windowsFont,
            appleFont: defaults.appleFont || renderState.appleFont,
            serifFont: defaults.serifFont || renderState.serifFont
        };

        replaceFontState(nextState);
    }

    function replaceFontState(nextState) {
        if (reactFontControlsSession) {
            return reactFontControlsSession.replaceState(nextState);
        }
        if (reactFontPreviewNode) {
            return false;
        }

        renderState.customFont = nextState.customFont;
        renderState.windowsFont = nextState.windowsFont;
        renderState.appleFont = nextState.appleFont;
        renderState.serifFont = nextState.serifFont;
        return true;
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
        $('#easymde-custom-css-id-field').val(renderState.markdownTheme === 'custom' ? renderState.customCssId : '');
    }

    function getAppearanceFields() {
        return {
            markdownTheme: document.getElementById('easymde-markdown-theme-field'),
            codeTheme: document.getElementById('easymde-code-theme-field'),
            customCssId: document.getElementById('easymde-custom-css-id-field')
        };
    }

    function hasUsableAppearanceFields(fields) {
        return !!(
            fields
            && fields.markdownTheme
            && 'value' in fields.markdownTheme
            && fields.codeTheme
            && 'value' in fields.codeTheme
            && fields.customCssId
            && 'value' in fields.customCssId
        );
    }

    function syncAppearanceFields(fields) {
        fields = fields || getAppearanceFields();
        if (!hasUsableAppearanceFields(fields)) {
            return false;
        }

        fields.markdownTheme.value = renderState.markdownTheme || 'default';
        fields.codeTheme.value = renderState.codeTheme || 'atom-one-dark';
        fields.customCssId.value = renderState.markdownTheme === 'custom' ? renderState.customCssId : '';
        return true;
    }

    function getAppearanceSnapshot() {
        return {
            customCss: customCssLibrary.slice(),
            state: {
                markdownTheme: renderState.markdownTheme,
                codeTheme: renderState.codeTheme,
                customCssId: renderState.markdownTheme === 'custom' ? renderState.customCssId : ''
            }
        };
    }

    function syncReactAppearanceSnapshot() {
        if (!reactAppearanceSession || typeof reactAppearanceSession.replaceSnapshot !== 'function') {
            return true;
        }

        return reactAppearanceSession.replaceSnapshot(getAppearanceSnapshot());
    }

    function applyAppearanceState(nextState, context, options) {
        var articleTheme;
        var codeTheme;
        var customItem;
        var fields;

        options = options || {};
        fields = options.fields || getAppearanceFields();
        if (!nextState || !context || !context.preview || !hasUsableAppearanceFields(fields)) {
            return false;
        }
        codeTheme = findById(themeOptions.codeThemes || [], String(nextState.codeTheme || ''));
        if (!codeTheme) {
            return false;
        }
        if (String(nextState.markdownTheme || '') === 'custom') {
            customItem = findById(customCssLibrary, String(nextState.customCssId || ''));
            if (
                !customItem
                && !(
                    renderState.markdownTheme === 'custom'
                    && renderState.customCssId === String(nextState.customCssId || '')
                    && renderState.scopedCustomCss
                )
            ) {
                return false;
            }
            renderState.markdownTheme = 'custom';
            if (customItem) {
                renderState.customCssId = customItem.id;
                renderState.customCss = customItem.css || '';
                renderState.scopedCustomCss = customItem.scopedCss || '';
            }
        } else {
            articleTheme = findById(themeOptions.markdownThemes || [], String(nextState.markdownTheme || ''));
            if (!articleTheme || nextState.customCssId) {
                return false;
            }
            renderState.markdownTheme = articleTheme.id;
            renderState.customCssId = '';
            renderState.customCss = '';
            renderState.scopedCustomCss = '';
            applyThemeFontDefaults(articleTheme.id);
        }
        renderState.codeTheme = codeTheme.id;
        themeOptions.state = renderState;
        if (!syncAppearanceFields(fields)) {
            return false;
        }
        applyRenderState(context.preview, { syncFields: false });
        if (typeof context.refreshPreview === 'function') {
            context.refreshPreview({ immediate: true });
        }
        return true;
    }

    function getFontFields() {
        return {
            customFont: document.getElementById('easymde-custom-font-field'),
            windowsFont: document.getElementById('easymde-windows-font-field'),
            appleFont: document.getElementById('easymde-apple-font-field'),
            serifFont: document.getElementById('easymde-serif-font-field')
        };
    }

    function hasUsableFontFields(fields) {
        return !!(
            fields
            && fields.customFont
            && 'value' in fields.customFont
            && fields.windowsFont
            && 'value' in fields.windowsFont
            && fields.appleFont
            && 'value' in fields.appleFont
            && fields.serifFont
            && 'value' in fields.serifFont
        );
    }

    function syncFontFields(fields) {
        fields = fields || getFontFields();

        if (!hasUsableFontFields(fields)) {
            return false;
        }

        fields.customFont.value = renderState.customFont || 'optima';
        fields.windowsFont.value = renderState.windowsFont || 'microsoft-yahei';
        fields.appleFont.value = renderState.appleFont || 'pingfang-sc-light';
        fields.serifFont.value = renderState.serifFont || 'yes';
        return true;
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

    function applyArticleThemeLink() {
        themeManager.applyArticleThemeLink(themeOptions, renderState, findById, document);
    }

    function applyRenderState($targetPreview, options) {
        var preview = $targetPreview[0];
        var markdownClass = renderState.markdownTheme === 'custom'
            ? 'easymde-markdown-theme-custom'
            : 'easymde-markdown-theme-' + renderState.markdownTheme;

        options = options || {};

        if (!preview) {
            return;
        }

        replaceClassPrefix(preview, 'easymde-markdown-theme-', markdownClass);
        replaceClassPrefix(preview, 'easymde-code-theme-', 'easymde-code-theme-' + renderState.codeTheme);
        $targetPreview.addClass('easymde-rendered-content easymde-code-mac');
        $targetPreview.toggleClass('easymde-custom-css-active', renderState.markdownTheme === 'custom');
        if (preview !== reactFontPreviewNode) {
            applyFontState($targetPreview, {
                syncFields: options.syncFields !== false && !reactFontPreviewNode
            });
        }

        if (options.syncFields !== false) {
            syncThemeFields();
        }
        applyArticleThemeLink();
        setCustomCssStyle(renderState.markdownTheme === 'custom' ? selectedCustomCss() : '');
    }

    function applyFontState($preview, options) {
        var preview = $preview && $preview[0];
        var fontStack;

        options = options || {};
        if (
            !preview
            || !preview.style
            || typeof preview.style.setProperty !== 'function'
            || typeof preview.style.removeProperty !== 'function'
            || !$preview
            || typeof $preview.toggleClass !== 'function'
        ) {
            return false;
        }

        fontStack = buildFontStack();
        $preview.toggleClass('easymde-font-overrides', !!fontStack);
        if (fontStack) {
            preview.style.setProperty('--easymde-content-font-family', fontStack);
        } else {
            preview.style.removeProperty('--easymde-content-font-family');
        }

        if (options.syncFields !== false && !syncFontFields(options.fields)) {
            return false;
        }
        syncFontControls();
        return true;
    }

    function fillCustomPanel($panel) {
        var item = selectedCustomCssItem();

        $panel.find('.easymde-custom-css-name').val(item ? item.name : '');
        $panel.find('.easymde-custom-css-code').val(item ? item.css : '');
    }

    function createAppearanceMenu($container, context) {
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
            $customToggle = $('<button type="button" class="button button-secondary easymde-custom-css-toggle"></button>').text(getString('customCss'));
            $customPanel = $('<div class="easymde-custom-css-panel" hidden></div>');
            $name = $('<input type="text" class="regular-text easymde-custom-css-name">').attr('placeholder', getString('cssName'));
            $code = $('<textarea class="easymde-custom-css-code" spellcheck="false"></textarea>');
            $save = $('<button type="button" class="button button-primary"></button>').text(getString('saveCss'));
            $status = $('<span class="easymde-custom-css-status" aria-live="polite"></span>');

            renderThemeSelect(themeControl.select);
            renderCodeThemeSelect(codeControl.select);

            $customPanel.append(
                $('<div class="easymde-custom-css-row"></div>').append($name, $save, $status),
                $code
            );
            fillCustomPanel($customPanel);

            $panel.append(
                themeControl.root,
                codeControl.root,
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

                applyRenderState(context.preview);
                context.refreshPreview();
            });

            codeControl.select.on('change', function () {
                renderState.codeTheme = String($(this).val() || 'atom-one-dark');
                applyRenderState(context.preview);
                context.refreshPreview();
            });

            $customToggle.on('click', function () {
                $customPanel.prop('hidden', !$customPanel.prop('hidden'));
                fillCustomPanel($customPanel);
            });

            $save.on('click', function () {
                $status.text('');
                persistCustomCss({
                    id: renderState.markdownTheme === 'custom' ? renderState.customCssId : '',
                    name: $name.val(),
                    css: $code.val()
                }).then(function (response) {
                    renderThemeSelect(themeControl.select);
                    themeControl.select.val('custom:' + response.item.id);
                    applyRenderState(context.preview);
                    context.refreshPreview();
                    $status.text(getString('cssSaved'));
                }).catch(function () {
                    $status.text(getString('cssSaveFailed'));
                });
            });
        }

        registerPopover($button, $panel, { beforeOpen: populatePanel });
        $anchor.append($button, $panel);
        $container.append($anchor);
        return $anchor;
    }

    function createFontMenu($container, context) {
        var $anchor = createMenuAnchor('easymde-toolbar-popover-font');
        var $button = $('<button type="button" class="easymde-toolbar-button easymde-toolbar-button-menu easymde-toolbar-button-compact"></button>');
        var $panel = $('<div class="easymde-toolbar-popover easymde-toolbar-popover-font-panel" hidden></div>');
        var panelReady = false;

        if (!getFontGroup('customFonts').length) {
            return null;
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
                    applyRenderState(context.preview);
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
        return $anchor;
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

    function reportStartupConfigErrors($flash) {
        var message = String(config.categoryLoadError || '');

        if (!message) {
            return false;
        }

        showFlash($flash, 'error', message);
        if (window.console && typeof window.console.error === 'function') {
            window.console.error('[EasyMDE] ' + message);
        }

        return true;
    }

    function hasUnsavedDocumentChanges(workspaceApi, context, titleValue) {
        var titleSnapshot = context.titleSession
            && typeof context.titleSession.getSnapshot === 'function'
            ? context.titleSession.getSnapshot()
            : null;

        return workspaceApi.hasUnsavedWorkspaceChanges({
            initialMarkdown: context.savedMarkdown,
            initialTitle: titleSnapshot ? titleSnapshot.savedValue : context.savedTitle,
            markdown: context.textarea.value || '',
            title: titleSnapshot ? titleSnapshot.value : String(titleValue || '')
        });
    }

    function restoreLegacyDocumentSource(context, legacySource, preview) {
        if (typeof context.scrollSyncCleanup === 'function') {
            context.scrollSyncCleanup();
        }
        context.scrollSyncCleanup = bindScrollSync(legacySource, preview);
        context.documentSession = null;
        context.titleSession = null;
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
            dispatchNativeInput(textarea);
            $notice.remove();
            showFlash($flash, 'success', getString('draftRestored'));
        });

        $discard.on('click', function () {
            window.EasyMDEDraftStorage.discard(storage);
            $notice.remove();
            showFlash($flash, 'info', getString('draftDiscarded'));
        });

        $notice.append($message, $restore, $discard);
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

    function enhancePreviewSurface($preview, features, isCurrent) {
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

            if (typeof isCurrent === 'function' && !isCurrent()) {
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
        });
    }

    function enhancePreview($preview, features, revision, signature, markdown) {
        return enhancePreviewSurface($preview, features, function () {
            return isPreviewCurrent(revision, signature, markdown);
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

    function updateImmersiveToggle(context) {
        var $button = context && context.immersiveButton ? context.immersiveButton : null;
        var isImmersive = !!(
            context
            && context.immersiveWorkspace
            && typeof context.immersiveWorkspace.isActive === 'function'
            && context.immersiveWorkspace.isActive()
        );
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
        var workspace = context && context.immersiveWorkspace ? context.immersiveWorkspace : null;
        var isImmersive = !!(workspace && workspace.isActive && workspace.isActive());

        if (!workspace || enabled === isImmersive) {
            return;
        }

        closePopovers();
        if (enabled) {
            workspace.activate();
        } else {
            workspace.deactivate();
        }
        updateImmersiveToggle(context);
    }

    function isSuccessfulPostNotice(notice) {
        var classes = notice && notice.classList ? notice.classList : null;

        if (!classes || classes.contains('error') || classes.contains('notice-error')) {
            return false;
        }

        return classes.contains('updated') || classes.contains('notice-success');
    }

    function hasSuccessfulPostNotice() {
        if (!document.querySelectorAll) {
            return false;
        }

        return Array.prototype.some.call(
            document.querySelectorAll('#message, .notice-success'),
            isSuccessfulPostNotice
        );
    }

    function consumeImmersivePublishPreview(context) {
        var requestedAt;
        var previewUrl;
        var previewWindow;
        var sessionStorage = getSessionStorage();

        if (!sessionStorage || !hasSuccessfulPostNotice()) {
            return;
        }

        try {
            requestedAt = parseInt(sessionStorage.getItem('easymde:publish-preview-pending') || '', 10);
            sessionStorage.removeItem('easymde:publish-preview-pending');
        } catch (error) {
            return;
        }

        if (!isFinite(requestedAt) || Date.now() - requestedAt > 120000) {
            return;
        }

        previewUrl = $('#post-preview').attr('href') || $('#sample-permalink a').attr('href') || '';
        if (!previewUrl) {
            return;
        }

        previewWindow = window.open(previewUrl, 'easymde-publish-preview');
        if (!previewWindow) {
            showFlash(context.flash, 'info', getString('publishPreviewBlocked') || 'The article was saved, but the preview window was blocked.');
        }
    }

    function createImmersiveWorkspace(context) {
        var workspaceApi = window.EasyMDEImmersiveWorkspace;

        if (!workspaceApi || typeof workspaceApi.createController !== 'function') {
            return null;
        }

        return workspaceApi.createController({
            window: window,
            document: document,
            strings: config.strings || {},
            layoutKey: config.storage && config.storage.layoutKey
                ? config.storage.layoutKey
                : 'easymde:immersive-layout',
            adapter: {
                getLocalDraftsEnabled: getLocalDraftsEnabled,
                setLocalDraftsEnabled: setLocalDraftsEnabled,
                getSurfaceCommands: function (surface) {
                    return getSurfaceCommands(surface).map(function (command) {
                        return { id: command.id, label: getCommandLabel(command) };
                    });
                },
                getMarkdown: function () {
                    return context.textarea.value || '';
                },
                setMarkdown: function (markdown) {
                    if (context.textarea.value === markdown) {
                        return;
                    }
                    context.textarea.value = markdown;
                    dispatchNativeInput(context.textarea);
                },
                getTitle: function () {
                    return String($('#title').val() || '');
                },
                setTitle: function (nextTitle) {
                    var $title = $('#title');
                    if ($title.length && $title.val() !== nextTitle) {
                        $title.val(nextTitle);
                        dispatchNativeInput($title[0]);
                    }
                },
                subscribeTitle: function (callback) {
                    var $title = $('#title');
                    var namespace = '.easymdeImmersiveWorkspaceTitle';
                    var handler = function () {
                        callback(String($title.val() || ''));
                    };

                    $title.on('input' + namespace + ' change' + namespace, handler);
                    return function () {
                        $title.off(namespace);
                    };
                },
                decorateWechatIcon: function (workspaceRoot) {
                    var wechatTarget = workspaceRoot.querySelector('[data-wechat-icon]');
                    var wechatIcon = createWechatIcon();
                    var wechatNode = wechatIcon && wechatIcon[0];

                    if (!wechatNode || !wechatTarget) {
                        throw new Error('The original WeChat toolbar icon is unavailable.');
                    }
                    wechatTarget.replaceWith(wechatNode);
                },
                renderPreview: function (node, markdown, options) {
                    var sourceClasses = String(context.preview.attr('class') || '').split(/\s+/).filter(function (className) {
                        return className && className !== 'easymde-preview';
                    });
                    node.className = ['easymde-immersive-workspace__preview'].concat(sourceClasses).join(' ');
                    node.setAttribute('style', context.preview.attr('style') || '');
                    updatePreview($(node), markdown, options || {});
                },
                scrollSourceToOffset: function (textarea, offset) {
                    var line = textarea.value.slice(0, offset).split('\n').length - 1;
                    var style = window.getComputedStyle(textarea);
                    var lineHeight = parseFloat(style.lineHeight) || 24;
                    var paddingTop = parseFloat(style.paddingTop) || 0;
                    textarea.scrollTop = Math.max(0, paddingTop + (line * lineHeight) - (textarea.clientHeight * 0.2));
                },
                scrollPreviewToHeading: function (previewNode, index) {
                    var headings = previewNode
                        ? previewNode.querySelectorAll('h1, h2, h3, h4, h5, h6')
                        : [];
                    if (headings[index] && typeof headings[index].scrollIntoView === 'function') {
                        headings[index].scrollIntoView({ block: 'start' });
                    }
                },
                isPreviewReady: function (previewNode, markdown) {
                    return isPreviewReady(previewNode, markdown);
                },
                getAppearanceOptions: function () {
                    var themes = (themeOptions.markdownThemes || []).slice();

                    customCssLibrary.forEach(function (item) {
                        themes.push({ id: 'custom:' + item.id, label: item.name });
                    });
                    return {
                        codeThemes: themeOptions.codeThemes || [],
                        fonts: fontOptions || {},
                        state: $.extend({}, renderState, {
                            markdownTheme: renderState.markdownTheme === 'custom' && renderState.customCssId
                                ? 'custom:' + renderState.customCssId
                                : renderState.markdownTheme
                        }),
                        themes: themes
                    };
                },
                getCustomCssState: function () {
                    var item = selectedCustomCssItem();

                    return item ? $.extend({}, item) : null;
                },
                previewCustomCss: function (css) {
                    if (!window.wp || !window.wp.apiFetch || !config.customCssPreviewUrl) {
                        return Promise.reject(new Error(getString('cssSaveFailed') || 'CSS preview failed.'));
                    }

                    return window.wp.apiFetch({
                        url: config.customCssPreviewUrl,
                        method: 'POST',
                        headers: {
                            'X-WP-Nonce': config.nonce
                        },
                        data: {
                            css: String(css || '')
                        }
                    });
                },
                saveCustomCss: function (input, workspaceContext) {
                    return persistCustomCss(input).then(function (response) {
                        applyRenderState(context.preview);
                        applyRenderState($(workspaceContext.preview));
                        context.refreshPreview({ immediate: true });
                        updatePreview($(workspaceContext.preview), workspaceContext.markdown, { immediate: true });
                        if (!syncReactAppearanceSnapshot()) {
                            throw new Error('react-appearance-state-reconcile-failed');
                        }

                        return response.item;
                    });
                },
                updateAppearance: function (changes, workspaceContext) {
                    var nextFontState;
                    var fontStateChanged = false;

                    if (Object.prototype.hasOwnProperty.call(changes, 'markdownTheme')) {
                        var selectedTheme = String(changes.markdownTheme || 'default');
                        if (selectedTheme.indexOf('custom:') === 0) {
                            var customItem = findById(customCssLibrary, selectedTheme.slice(7));
                            if (customItem) {
                                renderState.markdownTheme = 'custom';
                                renderState.customCssId = customItem.id;
                                renderState.customCss = customItem.css || '';
                                renderState.scopedCustomCss = customItem.scopedCss || '';
                            }
                        } else {
                            renderState.markdownTheme = selectedTheme;
                            renderState.customCssId = '';
                            renderState.customCss = '';
                            renderState.scopedCustomCss = '';
                            applyThemeFontDefaults(renderState.markdownTheme);
                        }
                    }
                    nextFontState = {
                        customFont: renderState.customFont,
                        windowsFont: renderState.windowsFont,
                        appleFont: renderState.appleFont,
                        serifFont: renderState.serifFont
                    };
                    ['codeTheme', 'customFont', 'windowsFont', 'appleFont', 'serifFont'].forEach(function (key) {
                        if (Object.prototype.hasOwnProperty.call(changes, key)) {
                            if (key === 'codeTheme') {
                                renderState.codeTheme = String(changes[key] || '');
                            } else {
                                nextFontState[key] = String(changes[key] || '');
                                fontStateChanged = true;
                            }
                        }
                    });
                    if (fontStateChanged && !replaceFontState(nextFontState)) {
                        throw new Error('font-state-replacement-failed');
                    }
                    themeOptions.state = renderState;
                    applyRenderState(context.preview);
                    applyRenderState($(workspaceContext.preview));
                    syncFontControls();
                    context.refreshPreview({ immediate: true });
                    updatePreview($(workspaceContext.preview), workspaceContext.markdown, { immediate: true });
                    if (!syncReactAppearanceSnapshot()) {
                        throw new Error('react-appearance-state-reconcile-failed');
                    }
                },
                executeCommand: function (commandId, textarea, commandContext) {
                    if (!getCommand(commandId)) {
                        throw new Error('Unknown immersive Markdown command: ' + commandId);
                    }
                    return executeCommand(commandId, $.extend({
                        textarea: textarea,
                        preview: $(context.preview),
                        flash: context.flash
                    }, commandContext || {}));
                },
                insertTable: function (rows, columns, textarea) {
                    var markdown = workspaceApi.createTableMarkdown(rows, columns, {
                        column: getString('tableColumn') || 'Column ',
                        content: getString('tableContent') || 'Content'
                    });
                    var start = textarea.selectionStart;
                    var end = textarea.selectionEnd;
                    var value = textarea.value;
                    var leading = start > 0 && value.charAt(start - 1) !== '\n' ? '\n' : '';
                    var trailing = end < value.length && value.charAt(end) !== '\n' ? '\n' : '';
                    var replacement = leading + markdown + trailing;
                    var firstCellLabel = getString('tableContent') || 'Content';
                    var firstCellOffset = markdown.indexOf(firstCellLabel);
                    var firstCellStart;
                    var firstCellEnd;

                    if (firstCellOffset < 0) {
                        firstCellLabel = (getString('tableColumn') || 'Column ') + '1';
                        firstCellOffset = markdown.indexOf(firstCellLabel);
                    }
                    firstCellStart = start + leading.length + Math.max(0, firstCellOffset);
                    firstCellEnd = firstCellStart + firstCellLabel.length;
                    applyTextChange(textarea, value.slice(0, start) + replacement + value.slice(end), firstCellStart, firstCellEnd);
                    textarea.setSelectionRange(firstCellStart, firstCellEnd);
                    textarea.focus();
                },
                handleShortcut: function (event, textarea, executeSourceCommand) {
                    var shortcut = normalizeEventShortcut(event);
                    var matchedCommand = null;
                    var command;

                    if (!shortcut || event.isComposing || event.keyCode === 229) {
                        return false;
                    }
                    Object.keys(getCommandMap()).some(function (commandId) {
                        if (getShortcutForCommand(commandId) === shortcut) {
                            matchedCommand = commandId;
                            return true;
                        }
                        return false;
                    });
                    if (!matchedCommand) {
                        return false;
                    }
                    command = getCommand(matchedCommand);
                    if (
                        event.target !== textarea
                        && (!command || ['savePost', 'copyWechat'].indexOf(command.action) === -1)
                    ) {
                        return false;
                    }
                    if (
                        event.target === textarea
                        && command
                        && ['savePost', 'copyWechat'].indexOf(command.action) === -1
                    ) {
                        if (typeof executeSourceCommand !== 'function') {
                            throw new Error('The immersive source command shortcut adapter is unavailable.');
                        }
                        executeSourceCommand(matchedCommand);
                        return true;
                    }
                    executeCommand(matchedCommand, { textarea: textarea, preview: $(context.preview), flash: context.flash });
                    return true;
                },
                performAction: function (action, workspaceContext) {
                    if (action === 'save') {
                        triggerSavePost(skipNextCrossDocumentViewTransition);
                    } else if (action === 'publish') {
                        skipNextCrossDocumentViewTransition();
                        $('#publish').trigger('click');
                    } else if (action === 'copy-markdown') {
                        if (window.navigator.clipboard && typeof window.navigator.clipboard.writeText === 'function') {
                            window.navigator.clipboard.writeText(workspaceContext.source.value);
                        }
                    } else if (action === 'wechat') {
                        return copyWechat({ preview: $(workspaceContext.preview), flash: context.flash });
                    } else if (action === 'history') {
                        var link = document.querySelector('#revisionsdiv .inside a, #misc-publishing-actions .misc-pub-revisions a');
                        if (link && link.href) {
                            window.location.href = link.href;
                        }
                    } else if (action === 'theme') {
                        $('.easymde-toolbar-popover-appearance > button').trigger('click');
                    } else if (action === 'font') {
                        $('.easymde-toolbar-popover-font > button').trigger('click');
                    }
                },
                getFeaturedImageCandidate: function (markdown) {
                    var candidate = workspaceApi.findFirstLocalImageCandidate(markdown, {
                        siteUrl: window.location.href,
                        uploadsUrl: config.uploadsBaseUrl || ''
                    });
                    var candidateUrl;
                    var searchTerm;

                    if (!candidate || !window.wp || typeof window.wp.apiFetch !== 'function') {
                        return Promise.resolve(null);
                    }

                    try {
                        candidateUrl = new window.URL(candidate.url);
                        searchTerm = decodeURIComponent(candidateUrl.pathname.split('/').pop() || '')
                            .replace(/-\d+x\d+(?=\.[^.]+$)/, '')
                            .replace(/\.[^.]+$/, '');
                    } catch (error) {
                        return Promise.resolve(null);
                    }

                    return window.wp.apiFetch({
                        path: '/wp/v2/media?context=edit&media_type=image&per_page=20&_fields=id,source_url,alt_text,media_details&search=' + encodeURIComponent(searchTerm)
                    }).then(function (attachments) {
                        var normalizedCandidate = candidateUrl.origin + candidateUrl.pathname;
                        var attachment = (attachments || []).find(function (item) {
                            var urls = [item && item.source_url ? item.source_url : ''];
                            var sizes = item && item.media_details && item.media_details.sizes
                                ? item.media_details.sizes
                                : {};

                            Object.keys(sizes).forEach(function (size) {
                                if (sizes[size] && sizes[size].source_url) {
                                    urls.push(sizes[size].source_url);
                                }
                            });

                            return urls.some(function (url) {
                                try {
                                    var mediaUrl = new window.URL(url, window.location.href);
                                    return mediaUrl.origin + mediaUrl.pathname === normalizedCandidate;
                                } catch (error) {
                                    return false;
                                }
                            });
                        });

                        if (!attachment || !attachment.id) {
                            return null;
                        }

                        return {
                            id: attachment.id,
                            url: candidate.url,
                            alt: candidate.alt || attachment.alt_text || ''
                        };
                    }).catch(function (error) {
                        if (error && (error.status === 401 || error.status === 403)) {
                            return null;
                        }
                        throw error;
                    });
                },
                getPublishState: function () {
                    var categoryInputs = document.querySelectorAll('#categorychecklist input[type="checkbox"]');
                    var categoryOptions = readNativeCategoryOptions(document, config.categoryOptions);
                    var featuredId = parseInt(String($('#_thumbnail_id').val() || ''), 10);
                    var featuredImage = null;
                    var featuredPreview = document.querySelector('#postimagediv .inside img');
                    var visibility = readNativePublishVisibility(document);

                    if (isFinite(featuredId) && featuredId > 0) {
                        featuredImage = {
                            id: featuredId,
                            url: featuredPreview && featuredPreview.src ? featuredPreview.src : '',
                            alt: featuredPreview && featuredPreview.alt ? featuredPreview.alt : ''
                        };
                    }

                    return {
                        capabilities: getNativePublishCapabilities(document),
                        categories: Array.prototype.map.call(categoryInputs, function (input) {
                            return input.checked ? String(input.value || '') : '';
                        }).filter(Boolean),
                        categoryOptions: categoryOptions,
                        excerpt: String($('#excerpt').val() || ''),
                        featuredImage: featuredImage,
                        openPreview: false,
                        password: visibility.password,
                        postStatus: String($('#post_status').val() || ''),
                        sticky: visibility.sticky,
                        tags: String($('#tax-input-post_tag').val() || ''),
                        visibility: visibility.visibility
                    };
                },
                getRevisions: function () {
                    var postId = parseInt(String($('#post_ID').val() || ''), 10);

                    if (!isFinite(postId) || postId <= 0 || !window.wp || typeof window.wp.apiFetch !== 'function') {
                        return Promise.resolve([]);
                    }

                    return window.wp.apiFetch({
                        path: '/easymde/v1/posts/' + postId + '/revisions'
                    }).then(function (response) {
                        return response && Array.isArray(response.revisions) ? response.revisions : [];
                    });
                },
                getRevision: function (revisionId) {
                    var postId = parseInt(String($('#post_ID').val() || ''), 10);
                    var id = parseInt(String(revisionId || ''), 10);

                    if (
                        !isFinite(postId)
                        || postId <= 0
                        || !isFinite(id)
                        || id <= 0
                        || !window.wp
                        || typeof window.wp.apiFetch !== 'function'
                    ) {
                        return Promise.reject(new Error('Revision preview is unavailable.'));
                    }

                    return window.wp.apiFetch({
                        path: '/easymde/v1/posts/' + postId + '/revisions/' + id
                    });
                },
                renderRevisionPreview: function (node, revision) {
                    var renderRevision = ++revisionPreviewRevision;
                    var stagingNode;
                    var $staging;

                    if (!node || !revision || typeof revision.html !== 'string') {
                        return Promise.reject(new Error('Revision preview is unavailable.'));
                    }
                    stagingNode = document.createElement('div');
                    stagingNode.className = 'easymde-immersive-workspace__history-preview easymde-rendered-content easymde-code-mac';
                    $staging = $(stagingNode);
                    $staging.html(revision.html);

                    return enhancePreviewSurface($staging, revision.features || {}).then(function (ready) {
                        if (!ready || renderRevision !== revisionPreviewRevision) {
                            return false;
                        }
                        node.className = stagingNode.className;
                        $(node).html(stagingNode.innerHTML);
                        return true;
                    });
                },
                openRevision: function (revisionId) {
                    var id = parseInt(String(revisionId || ''), 10);
                    if (isFinite(id) && id > 0) {
                        window.location.href = window.ajaxurl.replace(/admin-ajax\.php(?:\?.*)?$/, 'revision.php?revision=' + id);
                    }
                },
                confirmRevisionNavigation: function () {
                    return window.confirm(
                        getString('historyUnsavedConfirm')
                        || 'You have unsaved title or Markdown changes. Continue to revision history and leave these changes behind?'
                    );
                },
                hasUnsavedChanges: function () {
                    return hasUnsavedDocumentChanges(workspaceApi, context, $('#title').val());
                },
                selectFeaturedImage: function (callback) {
                    var frame;

                    if (!window.wp || !window.wp.media) {
                        showFlash(context.flash, 'error', getString('imagePasteFailed'));
                        return;
                    }

                    frame = window.wp.media({
                        title: getString('selectFeaturedImage') || 'Select featured image',
                        button: { text: getString('useFeaturedImage') || 'Use featured image' },
                        library: { type: 'image' },
                        multiple: false
                    });
                    frame.on('select', function () {
                        var attachment = frame.state().get('selection').first();
                        var data = attachment ? attachment.toJSON() : null;
                        if (data && data.id) {
                            callback({
                                id: data.id,
                                url: data.url || '',
                                alt: data.alt || data.title || ''
                            });
                        }
                    });
                    frame.open();
                },
                publish: function (draft) {
                    var preflight = preflightNativePublish(draft, document);
                    var selectedCategories = Object.create(null);
                    var featuredId = draft.featuredImage && draft.featuredImage.id
                        ? String(draft.featuredImage.id)
                        : '-1';
                    var sessionStorage;

                    if (!preflight.ok) {
                        showFlash(context.flash, 'error', getString('publishVisibilityUnavailable'));
                        return false;
                    }
                    if (
                        preflight.capabilities.visibility
                        && !applyNativePublishVisibility(draft, document)
                    ) {
                        showFlash(context.flash, 'error', getString('publishVisibilityUnavailable'));
                        return false;
                    }

                    if (preflight.capabilities.categories) {
                        (draft.categories || []).forEach(function (id) {
                            selectedCategories[String(id)] = true;
                        });
                        document.querySelectorAll('#categorychecklist input[type="checkbox"], #categorychecklist-pop input[type="checkbox"]').forEach(function (input) {
                            input.checked = !!selectedCategories[String(input.value || '')];
                        });
                    }
                    if (preflight.capabilities.tags) {
                        $('#tax-input-post_tag').val((draft.tags || []).join(', ')).trigger('change');
                    }
                    if (preflight.capabilities.excerpt) {
                        $('#excerpt').val(draft.excerpt || '').trigger('change');
                    }
                    if (preflight.capabilities.featuredImage) {
                        $('#_thumbnail_id').val(featuredId).trigger('change');
                    }

                    if (preflight.capabilities.visibility) {
                        $('#visibility-radio-' + draft.visibility).trigger('change');
                        $('#visibility .save-post-visibility').trigger('click');
                    }

                    sessionStorage = getSessionStorage();
                    if (draft.openPreview && sessionStorage) {
                        try {
                            sessionStorage.setItem(
                                'easymde:publish-preview-pending',
                                String(Date.now())
                            );
                        } catch (error) {
                            // Preview-after-publish is optional; saving must continue if storage is blocked.
                        }
                    }
                    skipNextCrossDocumentViewTransition();
                    $('#publish').trigger('click');
                    return true;
                },
                onActivate: function (workspaceContext) {
                    bindLazyImagePasteUpload(workspaceContext.source, context.root, context.flash);
                    updateImmersiveToggle(context);
                },
                onDeactivate: function () {
                    context.refreshPreview({ immediate: true });
                    updateImmersiveToggle(context);
                }
            }
        });
    }

    function getLocalDraftsEnabled() {
        return localDraftsEnabled;
    }

    function setLocalDraftsEnabled(enabled) {
        localDraftsEnabled = !!enabled;

        if (!localDraftsEnabled && draftTimer !== null) {
            window.clearTimeout(draftTimer);
            draftTimer = null;
        }

        return localDraftsEnabled;
    }

    function scheduleLocalDraft(storage, getMarkdown, onSaved) {
        if (!localDraftsEnabled) {
            return false;
        }

        window.clearTimeout(draftTimer);
        draftTimer = window.setTimeout(function () {
            draftTimer = null;
            if (!localDraftsEnabled) {
                return;
            }

            window.EasyMDEDraftStorage.write(storage, getMarkdown());
            if (typeof onSaved === 'function') {
                onSaved();
            }
        }, 500);

        return true;
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
        if ($preview[0]) {
            $preview[0].easymdePreviewSignature = null;
        }
        setPreviewBusy($preview, true);
        $preview.attr('data-easymde-preview-refreshing', '1');
        $preview.removeAttr('data-easymde-preview-error');

        if (replaceContent) {
            $preview.html('<p class="easymde-preview-pending" role="status">' + escapeHtml(getString('previewRendering')) + '</p>');
        }
    }

    function setPreviewReady($preview, signature) {
        setPreviewBusy($preview, false);
        $preview.removeAttr('data-easymde-preview-error');
        $preview.removeAttr('data-easymde-preview-refreshing');
        if ($preview[0]) {
            $preview[0].easymdePreviewSignature = typeof signature === 'string' ? signature : null;
        }
    }

    function isPreviewReady(previewNode, markdown) {
        return !!(
            previewNode
            && previewNode.easymdePreviewSignature === currentPreviewSignature(markdown)
            && previewNode.getAttribute('aria-busy') !== 'true'
            && !previewNode.hasAttribute('data-easymde-preview-refreshing')
            && !previewNode.hasAttribute('data-easymde-preview-error')
        );
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

    function bindLazyImagePasteUpload(textarea, $root, $flash, eventTarget) {
        eventTarget = eventTarget || textarea;

        function replayWhenLoaded(event, handlerName, source) {
            var transfer;

            if (
                (eventTarget === textarea && textarea.easymdeImagePasteBound)
                || !eventHasImageFileTransfer(event)
            ) {
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

        if (eventTarget === textarea && bindImagePaste(textarea, $root, $flash)) {
            return true;
        }

        if (
            !textarea
            || !eventTarget
            || eventTarget.easymdeImagePasteLazyBound
            || typeof eventTarget.addEventListener !== 'function'
            || !canUseImagePasteUpload()
        ) {
            return false;
        }

        eventTarget.easymdeImagePasteLazyBound = true;
        eventTarget.addEventListener('paste', function (event) {
            replayWhenLoaded(event, 'handlePaste', 'paste');
        });
        eventTarget.addEventListener('dragover', function (event) {
            replayWhenLoaded(event, 'handleDragOver', 'dragover');
        });
        eventTarget.addEventListener('drop', function (event) {
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
            return window.EasyMDEWechatExporter.copy(context, callbacks);
        }

        preloadWechatExporter().catch(function () {
            showFlash(context && context.flash ? context.flash : null, 'error', getString('copyWechatFailed'));
        });
        showFlash(context && context.flash ? context.flash : null, 'error', getString('copyWechatFailed'));
        return Promise.reject(new Error(getString('copyWechatFailed') || 'Copy for WeChat failed.'));
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

    function mediaPickerOptions(context) {
        context = context || {};
        return {
            title: getString('insertMedia'),
            altText: getString('mediaAltText'),
            defaultAlt: getString('mediaDefaultAlt'),
            insertAround: insertAround,
            applyTextChange: applyTextChange,
            selection: context.selection || null,
            notifyInput: context.notifyInput,
            restoreFocus: context.restoreFocus,
            commitSourceChange: context.commitSourceChange
        };
    }

    function createReactMediaPickerDocumentPort(textarea, context) {
        var capturedScroll = null;

        function activeSession() {
            var session = context && context.documentSession;

            if (
                session
                && typeof session.applyTextChange === 'function'
                && typeof session.focus === 'function'
                && typeof session.getScrollElement === 'function'
                && typeof session.getSelection === 'function'
                && typeof session.getValue === 'function'
            ) {
                return session;
            }

            return null;
        }

        function scrollElement(session) {
            return session ? session.getScrollElement() : textarea;
        }

        function captureScroll(session) {
            var element;

            if (capturedScroll) {
                return;
            }
            element = scrollElement(session);
            capturedScroll = {
                left: element && typeof element.scrollLeft === 'number' ? element.scrollLeft : 0,
                top: element && typeof element.scrollTop === 'number' ? element.scrollTop : 0
            };
        }

        function restoreScroll(session) {
            var element = scrollElement(session);

            if (!capturedScroll || !element) {
                return;
            }
            element.scrollLeft = capturedScroll.left;
            element.scrollTop = capturedScroll.top;
        }

        return {
            applyTextChange: function (change) {
                var session = activeSession();

                if (session) {
                    session.applyTextChange(change);
                } else {
                    applyTextChange(
                        textarea,
                        change.value,
                        change.selection.start,
                        change.selection.end
                    );
                }
                restoreScroll(session);
            },
            focus: function () {
                var session = activeSession();

                if (session) {
                    session.focus();
                } else {
                    focusWithoutScrolling(textarea);
                }
                restoreScroll(session);
            },
            getSnapshot: function () {
                var session = activeSession();
                var selection;
                var value;

                if (session) {
                    selection = session.getSelection();
                    value = session.getValue();
                } else {
                    selection = {
                        direction: textarea.selectionDirection || 'none',
                        end: textarea.selectionEnd,
                        start: textarea.selectionStart
                    };
                    value = textarea.value;
                }
                captureScroll(session);

                return {
                    selection: selection,
                    value: value
                };
            }
        };
    }

    function openReactMediaPicker(textarea, context) {
        var media = window.wp && typeof window.wp.media === 'function'
            ? window.wp.media.bind(window.wp)
            : null;

        return context.mediaPickerSession.open({
            document: createReactMediaPickerDocumentPort(textarea, context),
            media: media
        }).catch(function (error) {
            var code = error && /^media-picker-[a-z0-9-]+$/.test(error.message || '')
                ? error.message
                : 'media-picker-operation-failed';

            reportReactMediaPickerFailure(code);
            showFlash(
                context && context.flash ? context.flash : null,
                'error',
                getString('mediaPickerFailed') || 'The WordPress media library could not be opened.'
            );
            return false;
        });
    }

    function insertMediaPlaceholder(textarea) {
        insertAround(textarea, '![' + getString('mediaAltText') + '](', ')', '');
    }

    function restoreMediaPickerContext(textarea, context) {
        var selection = context && context.selection ? context.selection : null;

        if (selection) {
            textarea.setSelectionRange(
                selection.start,
                selection.end,
                selection.direction || 'none'
            );
            textarea.scrollTop = selection.scroll_top;
            textarea.scrollLeft = selection.scroll_left;
        }
        if (context && typeof context.restoreFocus === 'function') {
            context.restoreFocus();
        }
    }

    function openLoadedMediaPicker(textarea, context) {
        if (!textarea || !window.EasyMDEMediaPicker || !window.EasyMDEMediaPicker.open) {
            return false;
        }

        window.EasyMDEMediaPicker.open(textarea, mediaPickerOptions(context));
        return true;
    }

    function openMediaPicker(textarea, context) {
        context = context || {};
        if (context.mediaPickerSession && typeof context.mediaPickerSession.open === 'function') {
            return openReactMediaPicker(textarea, context);
        }
        try {
            if (openLoadedMediaPicker(textarea, context)) {
                return Promise.resolve(true);
            }
        } catch (error) {
            restoreMediaPickerContext(textarea, context);
            return Promise.reject(error);
        }

        if (!mediaPickerLoadPromise) {
            mediaPickerLoadPromise = loadDeferredScript(
                'easymde-media-picker-js',
                config.mediaPickerScriptUrl
            );
        }

        return mediaPickerLoadPromise.then(function (loaded) {
            if (loaded && openLoadedMediaPicker(textarea, context)) {
                return true;
            }
            if (!window.wp || !window.wp.media) {
                if (context.selection) {
                    textarea.setSelectionRange(
                        context.selection.start,
                        context.selection.end,
                        context.selection.direction || 'none'
                    );
                    textarea.scrollTop = context.selection.scroll_top;
                    textarea.scrollLeft = context.selection.scroll_left;
                }
                insertMediaPlaceholder(textarea);
                if (typeof context.commitSourceChange === 'function') {
                    context.commitSourceChange();
                }
                if (typeof context.notifyInput === 'function') {
                    context.notifyInput();
                }
                if (typeof context.restoreFocus === 'function') {
                    context.restoreFocus();
                }
                return false;
            }
            throw new Error(getString('mediaPickerFailed') || 'The WordPress media library could not be opened.');
        }).catch(function (error) {
            restoreMediaPickerContext(textarea, context);
            throw error;
        });
    }

    function previewNeedsDeferredEnhancement(features) {
        features = normalizePreviewFeatures(features || activePreviewFeatures);

        return !!(
            features.syntaxHighlight
            || features.math
            || features.mermaid
            || features.toc
            || features.codeBlocks
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
        var generation;
        var revision;
        var scheduleEnhancement;
        var signature;
        var scrollState;

        options = options || {};

        if ($preview.attr('data-easymde-initial-preview') !== '1' || !previewHasRenderedContent($preview)) {
            return false;
        }

        window.clearTimeout(previewTimer);
        previewTimer = null;
        abortPreviewRequest();

        features = normalizePreviewFeatures(initialPreviewFeatures($preview) || config.features || {});
        activePreviewFeatures = features;
        generation = ++normalPreviewGeneration;
        revision = ++previewRevision;
        signature = currentPreviewSignature(markdown);
        scrollState = capturePreviewScrollIfMoved(previewNode);

        function isHydrationCurrent(candidateMarkdown, candidateSignature) {
            return generation === normalPreviewGeneration
                && isPreviewCurrent(revision, candidateSignature, candidateMarkdown);
        }

        setPreviewReady($preview);

        applyRenderState($preview, { syncFields: false });

        afterPreviewIdle(function () {
            if (!isHydrationCurrent(markdown, signature)) {
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
            var enhancementSignature = currentPreviewSignature(enhancementMarkdown);

            afterPreviewIdle(function () {
                if (!isHydrationCurrent(enhancementMarkdown, enhancementSignature)) {
                    return;
                }

                enhancePreviewSurface($preview, features, function () {
                    return isHydrationCurrent(enhancementMarkdown, enhancementSignature);
                }).catch(function () {
                    if (isHydrationCurrent(enhancementMarkdown, enhancementSignature)) {
                        setPreviewEnhancementError($preview);
                    }

                    return false;
                }).then(function (ready) {
                    if (ready !== false && isHydrationCurrent(enhancementMarkdown, enhancementSignature)) {
                        setPreviewReady($preview, enhancementSignature);
                    }
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
            setPreviewReady($preview, signature);
        }
    }

    function abortPreviewRequest() {
        if (previewAbortController && typeof previewAbortController.abort === 'function') {
            previewAbortController.abort();
        }

        previewAbortController = null;
        previewRequestRevision = null;
    }

    function activateReactPreviewSession(container, $root, $preview, context) {
        var bridgeApi = window.EasyMDEReactPreviewSession;
        var bridge;
        var cleanup;
        var cleanupScheduled = false;
        var disposed = false;
        var failed = false;
        var mountPreviewGeneration;
        var pagehideRegistered = false;
        var ready = false;

        function activateSurface(surface) {
            var legacyNode = $preview[0];
            var nextPreview;
            var scrollState;
            var style;

            if (!legacyNode || !surface || surface === legacyNode || !surface.parentElement) {
                throw new Error('react-preview-surface-invalid');
            }

            if (typeof context.onPreviewSurfaceReady !== 'function') {
                throw new Error('react-preview-surface-consumer-invalid');
            }
            nextPreview = context.onPreviewSurfaceReady(surface);
            if (!nextPreview || !nextPreview[0] || nextPreview[0] !== surface) {
                throw new Error('react-preview-surface-consumer-invalid');
            }

            scrollState = capturePreviewScroll(legacyNode);
            style = legacyNode.getAttribute('style');
            surface.className = legacyNode.className;
            if (style) {
                surface.setAttribute('style', style);
            }
            legacyNode.removeAttribute('id');
            legacyNode.hidden = true;
            container.hidden = false;
            surface.id = 'easymde-preview';
            restorePreviewScroll(surface, scrollState);

            context.preview = nextPreview;
            $preview = context.preview;
            normalPreviewNode = surface;
            reactPreviewNode = surface;
        }

        function dispose() {
            if (disposed) {
                return;
            }
            disposed = true;
            if (pagehideRegistered && typeof window.removeEventListener === 'function') {
                window.removeEventListener('pagehide', dispose);
                pagehideRegistered = false;
            }
            if (reactPreviewRequestSession === context.previewRequestSession) {
                reactPreviewRequestSession = null;
                reactPreviewNode = null;
                context.previewRequestSession = null;
                if (ready) {
                    $root.attr('data-easymde-preview-request-owner', 'react-reload-required');
                    $root.attr('data-easymde-preview-surface-owner', 'react-reload-required');
                } else {
                    $root.attr('data-easymde-preview-request-owner', 'legacy');
                    $root.attr('data-easymde-preview-surface-owner', 'legacy');
                }
            }
            if (typeof cleanup === 'function') {
                cleanup();
            }
        }

        function scheduleCleanup() {
            if (cleanupScheduled) {
                return;
            }
            cleanupScheduled = true;
            if (typeof window.queueMicrotask === 'function') {
                window.queueMicrotask(dispose);
                return;
            }
            Promise.resolve().then(dispose);
        }

        $root.attr('data-easymde-preview-request-owner', 'legacy');
        $root.attr('data-easymde-preview-surface-owner', 'legacy');
        if (!container) {
            return null;
        }

        if (!bridgeApi || typeof bridgeApi.prepare !== 'function') {
            reportReactPreviewSessionFailure('react-preview-session-entry-unavailable');
            return null;
        }

        try {
            bridge = bridgeApi.prepare(config);
        } catch (error) {
            reportReactPreviewSessionFailure('react-preview-session-prepare-failed');
            return null;
        }

        if (!bridge || typeof bridge.mount !== 'function') {
            reportReactPreviewSessionFailure('react-preview-session-contract-invalid');
            return null;
        }

        try {
            mountPreviewGeneration = normalPreviewGeneration;
            cleanup = bridge.mount({
                container: container,
                initialRevision: previewRevision,
                onFailure: function () {
                    if (disposed || failed) {
                        return;
                    }
                    failed = true;
                    if (ready) {
                        reactPreviewSessionFailed = true;
                        reactPreviewRequestSession = null;
                        context.previewRequestSession = null;
                        if (reactPreviewNode) {
                            reactPreviewNode.easymdePreviewSignature = null;
                        }
                        $root.attr('data-easymde-preview-request-owner', 'react-reload-required');
                        $root.attr('data-easymde-preview-surface-owner', 'react-reload-required');
                        reportReactPreviewSessionFailure('react-preview-session-failed-after-handoff');
                        return;
                    }
                    $root.attr('data-easymde-preview-request-owner', 'legacy');
                    $root.attr('data-easymde-preview-surface-owner', 'legacy');
                    reportReactPreviewSessionFailure('react-preview-session-render-failed');
                    scheduleCleanup();
                },
                enhancementPort: {
                    enhance: function (surface, features, isCurrent) {
                        return enhancePreviewSurface($(surface), features, isCurrent).then(function (enhanced) {
                            if (enhanced === false) {
                                throw new Error('react-preview-enhancement-stale');
                            }
                        });
                    }
                },
                initial: {
                    features: normalizePreviewFeatures(initialPreviewFeatures($preview) || config.features || {}),
                    html: previewHasRenderedContent($preview) ? $preview.html() : '',
                    signature: currentPreviewSignature(String((context.textarea || {}).value || ''))
                },
                messages: {
                    empty: getString('previewEmpty'),
                    error: getString('previewError'),
                    rendering: getString('previewRendering')
                },
                onReady: function (runtime) {
                    var pendingRefresh;
                    var session = runtime && runtime.session;
                    var surface = runtime && runtime.surface;

                    if (disposed || failed || ready) {
                        return;
                    }
                    if (
                        !session
                        || typeof session.schedule !== 'function'
                        || typeof session.isCurrent !== 'function'
                    ) {
                        throw new Error('react-preview-session-invalid');
                    }

                    activateSurface(surface);
                    pendingRefresh = previewTimer !== null
                        || previewRequestRevision !== null
                        || normalPreviewGeneration !== mountPreviewGeneration;
                    normalPreviewGeneration += 1;
                    window.clearTimeout(previewTimer);
                    previewTimer = null;
                    if (pendingRefresh) {
                        previewRevision += 1;
                    }
                    abortPreviewRequest();
                    reactPreviewRequestSession = session;
                    reactPreviewSessionFailed = false;
                    context.previewRequestSession = session;
                    ready = true;
                    $root.attr('data-easymde-preview-request-owner', 'react');
                    $root.attr('data-easymde-preview-surface-owner', 'react');

                    if (pendingRefresh) {
                        updatePreview($preview, String((context.textarea || {}).value || ''), { immediate: true });
                    }
                },
                scrollPort: {
                    capture: function (surface) {
                        return capturePreviewScroll(surface);
                    },
                    restore: function (surface, state) {
                        restorePreviewScroll(surface, state);
                    }
                }
            });
        } catch (error) {
            reportReactPreviewSessionFailure('react-preview-session-mount-failed');
            return null;
        }

        if (typeof cleanup !== 'function') {
            reportReactPreviewSessionFailure('react-preview-session-cleanup-invalid');
            return null;
        }

        if (typeof window.addEventListener === 'function') {
            window.addEventListener('pagehide', dispose, { once: true });
            pagehideRegistered = true;
        }

        return dispose;
    }

    function updatePreview($preview, markdown, options) {
        var previewNode = $preview[0];
        var revision;
        var signature = currentPreviewSignature(markdown);
        var delay;

        options = options || {};

        if (reactPreviewSessionFailed && previewNode === reactPreviewNode) {
            return;
        }

        if (previewNode === normalPreviewNode || previewNode === reactPreviewNode) {
            normalPreviewGeneration += 1;
        }

        if (
            reactPreviewRequestSession
            && previewNode === reactPreviewNode
            && typeof reactPreviewRequestSession.schedule === 'function'
        ) {
            reactPreviewRequestSession.schedule({
                markdown: markdown,
                postId: parseInt(String($('#easymde-editor').data('post-id') || 0), 10) || 0,
                markdownTheme: String(renderState.markdownTheme || ''),
                codeTheme: String(renderState.codeTheme || ''),
                customCssId: String(renderState.customCssId || ''),
                signature: signature
            }, options.immediate === true);
            return;
        }

        revision = ++previewRevision;
        delay = options.immediate ? 0 : 180;

        function finishPreviewUpdate(scrollState) {
            applyRenderState($preview);
            restorePreviewScroll(previewNode, scrollState);
        }

        window.clearTimeout(previewTimer);
        previewTimer = null;
        abortPreviewRequest();

        if (!markdown.trim()) {
            activePreviewFeatures = normalizePreviewFeatures(config.features || {});
            setPreviewReady($preview, signature);
            $preview.html('<p class="easymde-preview-empty">' + escapeHtml(getString('previewEmpty')) + '</p>');
            finishPreviewUpdate(capturePreviewScroll(previewNode));
            return;
        }

        setPreviewPending($preview, !previewHasRenderedContent($preview));

        function runPreviewRequest() {
            var requestScrollState;
            var fetchOptions;
            var requestAbortController = null;

            if (!isPreviewCurrent(revision, signature, markdown)) {
                return;
            }

            previewTimer = null;
            requestScrollState = capturePreviewScroll(previewNode);

            if (!window.wp || !window.wp.apiFetch || !config.restUrl) {
                activePreviewFeatures = normalizePreviewFeatures(config.features || {});
                $preview.html(previewFallback(markdown));
                finishPreviewUpdate(requestScrollState);
                enhancePreview($preview, activePreviewFeatures, revision, signature, markdown).then(function (ready) {
                    finishEnhancedPreview($preview, revision, signature, markdown, ready);
                });
                return;
            }

            if (window.AbortController) {
                previewAbortController = new window.AbortController();
                requestAbortController = previewAbortController;
            }
            previewRequestRevision = revision;

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
                    custom_css_id: renderState.customCssId
                }
            };

            if (requestAbortController) {
                fetchOptions.signal = requestAbortController.signal;
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
                finishPreviewUpdate(requestScrollState);
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
                finishPreviewUpdate(requestScrollState);
            }).then(function () {
                if (previewAbortController === requestAbortController) {
                    previewAbortController = null;
                }
                if (previewRequestRevision === revision) {
                    previewRequestRevision = null;
                }
            });
        }

        if (delay <= 0) {
            runPreviewRequest();
            return;
        }

        previewTimer = window.setTimeout(runPreviewRequest, delay);
    }

    function bindScrollSync(sourceScroller, preview) {
        var $sourceScroller = $(sourceScroller);
        var $preview = $(preview);
        var namespace = '.easymdeScrollSync' + (++scrollSyncBindingId);

        $sourceScroller.on('scroll' + namespace, function () {
            if (syncLock) {
                return;
            }

            syncLock = true;
            var ratio = sourceScroller.scrollTop / Math.max(1, sourceScroller.scrollHeight - sourceScroller.clientHeight);
            preview.scrollTop = ratio * Math.max(1, preview.scrollHeight - preview.clientHeight);
            window.setTimeout(function () {
                syncLock = false;
            }, 30);
        });

        $preview.on('scroll' + namespace, function () {
            if (syncLock) {
                return;
            }

            syncLock = true;
            var ratio = preview.scrollTop / Math.max(1, preview.scrollHeight - preview.clientHeight);
            sourceScroller.scrollTop = ratio * Math.max(1, sourceScroller.scrollHeight - sourceScroller.clientHeight);
            window.setTimeout(function () {
                syncLock = false;
            }, 30);
        });

        return function () {
            if (typeof $sourceScroller.off === 'function') {
                $sourceScroller.off(namespace);
            }
            if (typeof $preview.off === 'function') {
                $preview.off(namespace);
            }
        };
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
            return openMediaPicker(textarea, context);
        case 'savePost':
            triggerSavePost();
            break;
        case 'copyWechat':
            return copyWechat(context).catch(function () {
                // The exporter has already reported the failure through the editor flash.
                return false;
            });
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

    function reportReactToolbarFailure(code) {
        if (window.console && typeof window.console.error === 'function') {
            window.console.error('[EasyMDE] ' + code);
        }
    }

    function reportReactDocumentSourceFailure(code) {
        if (window.console && typeof window.console.error === 'function') {
            window.console.error('[EasyMDE] ' + code);
        }
    }

    function reportReactPreviewSessionFailure(code) {
        if (window.console && typeof window.console.error === 'function') {
            window.console.error('[EasyMDE] ' + code);
        }
    }

    function reportReactFontControlsFailure(code) {
        if (window.console && typeof window.console.error === 'function') {
            window.console.error('[EasyMDE] ' + code);
        }
    }

    function reportReactAppearanceFailure(code) {
        if (window.console && typeof window.console.error === 'function') {
            window.console.error('[EasyMDE] ' + code);
        }
    }

    function reportReactMediaPickerFailure(code) {
        if (window.console && typeof window.console.error === 'function') {
            window.console.error('[EasyMDE] ' + code);
        }
    }

    function isReactDocumentSession(session) {
        var documentSession = session && session.document;
        var titleSession = session && session.title;

        return !!(
            documentSession
            && typeof documentSession.applyTextChange === 'function'
            && typeof documentSession.flush === 'function'
            && typeof documentSession.focus === 'function'
            && typeof documentSession.getInputElement === 'function'
            && typeof documentSession.getScrollElement === 'function'
            && typeof documentSession.getSelection === 'function'
            && typeof documentSession.getValue === 'function'
            && typeof documentSession.syncFromSubmissionField === 'function'
            && titleSession
            && typeof titleSession.getSnapshot === 'function'
            && typeof titleSession.subscribe === 'function'
        );
    }

    function activateReactDocumentSource(sourcePane, reactSource, legacySource, titleField, context) {
        var reactDocumentSource = window.EasyMDEReactDocumentSource;
        var disposed = false;
        var failed = false;
        var ready = false;
        var cleanup;
        var cleanupScheduled = false;
        var pagehideRegistered = false;

        function restoreLegacyOwner() {
            reactSource.hidden = true;
            legacySource.hidden = false;
            sourcePane.setAttribute('data-easymde-document-owner', 'legacy');
        }

        function dispose() {
            if (disposed) {
                return;
            }

            disposed = true;
            if (pagehideRegistered && typeof window.removeEventListener === 'function') {
                window.removeEventListener('pagehide', dispose);
                pagehideRegistered = false;
            }
            if (context.documentSession && typeof context.documentSession.flush === 'function') {
                context.documentSession.flush();
            }
            if (typeof cleanup === 'function') {
                cleanup();
            }
            if (ready && typeof context.onDocumentSourceDisposed === 'function') {
                context.onDocumentSourceDisposed();
            }
            restoreLegacyOwner();
        }

        function scheduleCleanup() {
            if (cleanupScheduled) {
                return;
            }

            cleanupScheduled = true;
            if (typeof window.queueMicrotask === 'function') {
                window.queueMicrotask(dispose);
                return;
            }

            Promise.resolve().then(dispose);
        }

        function failBeforeHandoff(code) {
            if (disposed || failed || ready) {
                return;
            }

            failed = true;
            restoreLegacyOwner();
            reportReactDocumentSourceFailure(code);
            scheduleCleanup();
        }

        if (
            !sourcePane
            || typeof sourcePane.setAttribute !== 'function'
            || !reactSource
            || !legacySource
            || !titleField
        ) {
            return null;
        }

        restoreLegacyOwner();

        if (!reactDocumentSource || typeof reactDocumentSource.prepare !== 'function') {
            reportReactDocumentSourceFailure('react-document-source-entry-unavailable');
            return null;
        }

        try {
            reactDocumentSource = reactDocumentSource.prepare({
                strings: {
                    editorLabel: getString('editorLabel')
                }
            });
        } catch (error) {
            reportReactDocumentSourceFailure('react-document-source-prepare-failed');
            return null;
        }

        if (!reactDocumentSource || typeof reactDocumentSource.mount !== 'function') {
            reportReactDocumentSourceFailure('react-document-source-contract-invalid');
            return null;
        }

        try {
            cleanup = reactDocumentSource.mount({
                container: reactSource,
                submissionField: legacySource,
                titleField: titleField,
                onFailure: function () {
                    if (disposed || failed) {
                        return;
                    }

                    if (ready) {
                        sourcePane.setAttribute('data-easymde-document-owner', 'react-reload-required');
                        reportReactDocumentSourceFailure('react-document-source-failed-after-handoff');
                        return;
                    }

                    failBeforeHandoff('react-document-source-render-failed');
                },
                onReady: function (session) {
                    if (disposed || failed || ready) {
                        return;
                    }

                    if (!isReactDocumentSession(session)) {
                        failBeforeHandoff('react-document-source-session-invalid');
                        return;
                    }

                    try {
                        if (typeof context.onDocumentSourceReady === 'function') {
                            context.onDocumentSourceReady(session);
                        }
                    } catch (error) {
                        failBeforeHandoff('react-document-source-consumer-preflight-failed');
                        return;
                    }

                    context.documentSession = session.document;
                    context.titleSession = session.title;
                    ready = true;
                    legacySource.hidden = true;
                    reactSource.hidden = false;
                    sourcePane.setAttribute('data-easymde-document-owner', 'react');
                }
            });
        } catch (error) {
            reportReactDocumentSourceFailure('react-document-source-mount-failed');
            return null;
        }

        if (typeof cleanup !== 'function') {
            reportReactDocumentSourceFailure('react-document-source-cleanup-invalid');
            return null;
        }

        if (typeof window.addEventListener === 'function') {
            window.addEventListener('pagehide', dispose, { once: true });
            pagehideRegistered = true;
        }

        return dispose;
    }

    function activateReactMediaPicker(root, context) {
        var bridgeApi = window.EasyMDEReactMediaPicker;
        var pagehideRegistered = false;
        var disposed = false;
        var session;

        function dispose() {
            if (disposed) {
                return;
            }
            disposed = true;
            if (pagehideRegistered && typeof window.removeEventListener === 'function') {
                window.removeEventListener('pagehide', dispose);
                pagehideRegistered = false;
            }
            if (context.mediaPickerSession === session) {
                context.mediaPickerSession = null;
            }
            root.setAttribute('data-easymde-media-picker-owner', 'legacy');
        }

        if (!root || typeof root.setAttribute !== 'function' || !context) {
            reportReactMediaPickerFailure('react-media-picker-surface-invalid');
            return null;
        }
        root.setAttribute('data-easymde-media-picker-owner', 'legacy');
        if (!bridgeApi || typeof bridgeApi.prepare !== 'function') {
            reportReactMediaPickerFailure('react-media-picker-entry-unavailable');
            return null;
        }
        try {
            session = bridgeApi.prepare({
                defaultAlt: getString('mediaDefaultAlt'),
                insertMedia: getString('insertMedia'),
                placeholderAlt: getString('mediaAltText')
            });
        } catch (error) {
            reportReactMediaPickerFailure('react-media-picker-prepare-failed');
            return null;
        }
        if (!session || typeof session.open !== 'function') {
            reportReactMediaPickerFailure('react-media-picker-contract-invalid');
            return null;
        }

        context.mediaPickerSession = session;
        root.setAttribute('data-easymde-media-picker-owner', 'react');
        if (typeof window.addEventListener === 'function') {
            window.addEventListener('pagehide', dispose, { once: true });
            pagehideRegistered = true;
        }

        return dispose;
    }

    function activateReactToolbar(toolbar, reactMain, legacyMain, context) {
        var reactToolbar = window.EasyMDEReactToolbar;
        var disposed = false;
        var failed = false;
        var ready = false;
        var cleanup;
        var cleanupScheduled = false;
        var pagehideRegistered = false;

        function dispose() {
            if (disposed) {
                return;
            }

            disposed = true;
            if (pagehideRegistered && typeof window.removeEventListener === 'function') {
                window.removeEventListener('pagehide', dispose);
                pagehideRegistered = false;
            }
            if (typeof cleanup === 'function') {
                cleanup();
            }
            reactMain.hidden = true;
            legacyMain.hidden = false;
            toolbar.setAttribute('data-easymde-main-toolbar-owner', 'legacy');
        }

        function scheduleCleanup() {
            if (cleanupScheduled) {
                return;
            }

            cleanupScheduled = true;
            if (typeof window.queueMicrotask === 'function') {
                window.queueMicrotask(dispose);
                return;
            }

            Promise.resolve().then(dispose);
        }

        if (
            !toolbar
            || typeof toolbar.setAttribute !== 'function'
            || !reactMain
            || !legacyMain
        ) {
            return null;
        }

        toolbar.setAttribute('data-easymde-main-toolbar-owner', 'legacy');
        reactMain.hidden = true;
        legacyMain.hidden = false;

        if (!reactToolbar || typeof reactToolbar.prepare !== 'function') {
            reportReactToolbarFailure('react-toolbar-entry-unavailable');
            return null;
        }

        try {
            reactToolbar = reactToolbar.prepare({
                commands: config.commands || [],
                shortcuts: config.shortcuts || {},
                strings: {
                    headings: getString('headings')
                }
            });
        } catch (error) {
            reportReactToolbarFailure('react-toolbar-prepare-failed');
            return null;
        }

        if (!reactToolbar || typeof reactToolbar.mount !== 'function') {
            reportReactToolbarFailure('react-toolbar-contract-invalid');
            return null;
        }

        try {
            cleanup = reactToolbar.mount({
                container: reactMain,
                executeCommand: function (commandId) {
                    var command = getCommand(commandId);
                    var result = executeCommand(commandId, context);

                    if (
                        context
                        && context.documentSession
                        && (!command || 'image' !== command.action)
                        && typeof context.documentSession.focus === 'function'
                    ) {
                        context.documentSession.focus();
                    }

                    return result;
                },
                onFailure: function () {
                    if (disposed || failed) {
                        return;
                    }

                    failed = true;
                    reactMain.hidden = true;
                    legacyMain.hidden = false;
                    toolbar.setAttribute('data-easymde-main-toolbar-owner', 'legacy');
                    reportReactToolbarFailure('react-toolbar-render-failed');
                    scheduleCleanup();
                },
                onReady: function () {
                    if (disposed || failed || ready) {
                        return;
                    }

                    ready = true;
                    legacyMain.hidden = true;
                    reactMain.hidden = false;
                    toolbar.setAttribute('data-easymde-main-toolbar-owner', 'react');
                },
                platform: getIsMac() ? 'mac' : 'win'
            });
        } catch (error) {
            reportReactToolbarFailure('react-toolbar-mount-failed');
            return null;
        }

        if (typeof cleanup !== 'function') {
            reportReactToolbarFailure('react-toolbar-cleanup-invalid');
            return null;
        }

        if (typeof window.addEventListener === 'function') {
            window.addEventListener('pagehide', dispose, { once: true });
            pagehideRegistered = true;
        }

        return dispose;
    }

    function activateReactFontControls(owner, reactRoot, legacyRoot, context) {
        var reactFontControls = window.EasyMDEReactFontControls;
        var fields = getFontFields();
        var disposed = false;
        var failed = false;
        var failedAfterHandoff = false;
        var ready = false;
        var cleanup;
        var cleanupScheduled = false;
        var mountComplete = false;
        var pagehideRegistered = false;
        var pendingReadySession = null;
        var session = null;

        function setLegacyEnabled(enabled) {
            var controls;

            if (!legacyRoot || typeof legacyRoot.querySelectorAll !== 'function') {
                return;
            }
            controls = legacyRoot.querySelectorAll('select, button');
            Array.prototype.forEach.call(controls, function (control) {
                control.disabled = !enabled;
            });
        }

        function restoreLegacyOwner() {
            if (reactFontPreviewNode === context.preview[0]) {
                reactFontPreviewNode = null;
            }
            reactRoot.hidden = true;
            legacyRoot.hidden = false;
            setLegacyEnabled(true);
            syncFontControls();
            owner.setAttribute('data-easymde-font-controls-owner', 'legacy');
        }

        function abortUnownedMount(code) {
            failed = true;
            disposed = true;
            if (reactFontControlsSession === session) {
                reactFontControlsSession = null;
            }
            session = null;
            ready = false;
            restoreLegacyOwner();
            reportReactFontControlsFailure(code);
        }

        function dispose() {
            if (disposed) {
                return;
            }

            disposed = true;
            if (pagehideRegistered && typeof window.removeEventListener === 'function') {
                window.removeEventListener('pagehide', dispose);
                pagehideRegistered = false;
            }
            if (reactFontControlsSession === session) {
                reactFontControlsSession = null;
            }
            session = null;
            if (typeof cleanup === 'function') {
                cleanup();
            }
            reactRoot.hidden = true;
            if (!failedAfterHandoff) {
                restoreLegacyOwner();
            }
        }

        function scheduleCleanup() {
            if (cleanupScheduled) {
                return;
            }

            cleanupScheduled = true;
            if (typeof window.queueMicrotask === 'function') {
                window.queueMicrotask(dispose);
                return;
            }
            Promise.resolve().then(dispose);
        }

        function preflightPort() {
            var preview = context && context.preview && context.preview[0];

            return !!(
                hasUsableFontFields(fields)
                && preview
                && preview.style
                && typeof preview.style.setProperty === 'function'
                && typeof preview.style.removeProperty === 'function'
                && context.preview
                && typeof context.preview.toggleClass === 'function'
            );
        }

        function completeHandoff(nextSession) {
            var latestState;

            if (
                disposed
                || failed
                || ready
                || !nextSession
                || typeof nextSession.replaceState !== 'function'
                || typeof nextSession.close !== 'function'
                || !preflightPort()
            ) {
                if (!disposed && !failed && !ready) {
                    failed = true;
                    reportReactFontControlsFailure('react-font-controls-session-invalid');
                    scheduleCleanup();
                }
                return;
            }

            latestState = {
                customFont: renderState.customFont,
                windowsFont: renderState.windowsFont,
                appleFont: renderState.appleFont,
                serifFont: renderState.serifFont
            };
            if (nextSession.replaceState(latestState) !== true || disposed || failed) {
                if (!disposed && !failed) {
                    failed = true;
                    reportReactFontControlsFailure('react-font-controls-state-reconcile-failed');
                    scheduleCleanup();
                }
                return;
            }

            ready = true;
            session = nextSession;
            reactFontControlsSession = session;
            reactFontPreviewNode = context.preview[0];
            setLegacyEnabled(false);
            legacyRoot.hidden = true;
            reactRoot.hidden = false;
            owner.setAttribute('data-easymde-font-controls-owner', 'react');
        }

        if (
            !owner
            || typeof owner.setAttribute !== 'function'
            || !reactRoot
            || !legacyRoot
            || !preflightPort()
        ) {
            reportReactFontControlsFailure('react-font-controls-surface-invalid');
            return null;
        }

        owner.setAttribute('data-easymde-font-controls-owner', 'legacy');
        reactRoot.hidden = true;
        legacyRoot.hidden = false;

        if (!reactFontControls || typeof reactFontControls.prepare !== 'function') {
            reportReactFontControlsFailure('react-font-controls-entry-unavailable');
            return null;
        }

        try {
            reactFontControls = reactFontControls.prepare({
                options: fontOptions,
                state: {
                    customFont: renderState.customFont,
                    windowsFont: renderState.windowsFont,
                    appleFont: renderState.appleFont,
                    serifFont: renderState.serifFont
                },
                strings: {
                    font: getString('font'),
                    customFont: getString('customFont'),
                    windowsFont: getString('windowsFont'),
                    appleFont: getString('appleFont'),
                    serifFont: getString('serifFont'),
                    fontStackHelp: getString('fontStackHelp')
                }
            });
        } catch (error) {
            reportReactFontControlsFailure('react-font-controls-prepare-failed');
            return null;
        }

        if (!reactFontControls || typeof reactFontControls.mount !== 'function') {
            reportReactFontControlsFailure('react-font-controls-contract-invalid');
            return null;
        }

        try {
            cleanup = reactFontControls.mount({
                container: reactRoot,
                port: {
                    applyState: function (nextState) {
                        if (
                            !nextState
                            || !getFontOption('customFonts', nextState.customFont)
                            || !getFontOption('windowsFonts', nextState.windowsFont)
                            || !getFontOption('appleFonts', nextState.appleFont)
                            || !getFontOption('serifOptions', nextState.serifFont)
                            || !preflightPort()
                        ) {
                            throw new Error('react-font-controls-state-invalid');
                        }

                        renderState.customFont = nextState.customFont;
                        renderState.windowsFont = nextState.windowsFont;
                        renderState.appleFont = nextState.appleFont;
                        renderState.serifFont = nextState.serifFont;
                        if (!applyFontState(context.preview, { fields: fields })) {
                            throw new Error('react-font-controls-apply-failed');
                        }
                    },
                    closeOtherPopovers: closePopovers
                },
                onFailure: function () {
                    if (disposed || failed) {
                        return;
                    }

                    failed = true;
                    if (ready) {
                        failedAfterHandoff = true;
                        reactFontControlsSession = null;
                        session = null;
                        legacyRoot.hidden = true;
                        setLegacyEnabled(false);
                        owner.setAttribute('data-easymde-font-controls-owner', 'react-reload-required');
                        reportReactFontControlsFailure('react-font-controls-failed-after-handoff');
                    } else {
                        reactRoot.hidden = true;
                        legacyRoot.hidden = false;
                        setLegacyEnabled(true);
                        owner.setAttribute('data-easymde-font-controls-owner', 'legacy');
                        reportReactFontControlsFailure('react-font-controls-render-failed');
                    }
                    scheduleCleanup();
                },
                onReady: function (nextSession) {
                    if (!mountComplete) {
                        pendingReadySession = nextSession;
                        return;
                    }
                    completeHandoff(nextSession);
                }
            });
        } catch (error) {
            abortUnownedMount('react-font-controls-mount-failed');
            return null;
        }

        mountComplete = true;
        if (typeof cleanup !== 'function') {
            abortUnownedMount('react-font-controls-cleanup-invalid');
            return null;
        }
        if (pendingReadySession) {
            completeHandoff(pendingReadySession);
            pendingReadySession = null;
        }

        if (typeof window.addEventListener === 'function') {
            window.addEventListener('pagehide', dispose, { once: true });
            pagehideRegistered = true;
        }

        return dispose;
    }

    function activateReactAppearance(owner, reactRoot, legacyRoot, context) {
        var reactAppearance = window.EasyMDEReactAppearance;
        var fields = getAppearanceFields();
        var disposed = false;
        var failed = false;
        var failedAfterHandoff = false;
        var ready = false;
        var cleanup;
        var cleanupScheduled = false;
        var legacyControlStates = null;
        var mountComplete = false;
        var pagehideRegistered = false;
        var pendingReadySession = null;
        var session = null;

        function disableLegacyOwner() {
            var controls;
            if (!legacyRoot || typeof legacyRoot.querySelectorAll !== 'function') {
                return;
            }
            controls = legacyRoot.querySelectorAll('select, input, textarea, button');
            legacyControlStates = Array.prototype.map.call(controls, function (control) {
                return {
                    control: control,
                    disabled: !!control.disabled
                };
            });
            Array.prototype.forEach.call(controls, function (control) {
                control.disabled = true;
            });
        }

        function restoreLegacyControls() {
            if (!legacyControlStates) {
                return;
            }
            legacyControlStates.forEach(function (state) {
                state.control.disabled = state.disabled;
            });
            legacyControlStates = null;
        }

        function restoreLegacyOwner() {
            if (reactAppearancePreviewNode === context.preview[0]) {
                reactAppearancePreviewNode = null;
            }
            reactRoot.hidden = true;
            legacyRoot.hidden = false;
            restoreLegacyControls();
            owner.setAttribute('data-easymde-appearance-owner', 'legacy');
        }

        function dispose() {
            if (disposed) {
                return;
            }
            disposed = true;
            if (pagehideRegistered && typeof window.removeEventListener === 'function') {
                window.removeEventListener('pagehide', dispose);
                pagehideRegistered = false;
            }
            if (reactAppearanceSession === session) {
                reactAppearanceSession = null;
            }
            session = null;
            if (typeof cleanup === 'function') {
                cleanup();
            }
            reactRoot.hidden = true;
            if (!failedAfterHandoff) {
                restoreLegacyOwner();
            }
        }

        function scheduleCleanup() {
            if (cleanupScheduled) {
                return;
            }
            cleanupScheduled = true;
            if (typeof window.queueMicrotask === 'function') {
                window.queueMicrotask(dispose);
                return;
            }
            Promise.resolve().then(dispose);
        }

        function failBeforeHandoff(code) {
            if (disposed || failed || ready) {
                return;
            }
            failed = true;
            restoreLegacyOwner();
            reportReactAppearanceFailure(code);
            scheduleCleanup();
        }

        function completeHandoff(nextSession) {
            var reconciled;

            if (
                disposed
                || failed
                || ready
                || !nextSession
                || typeof nextSession.close !== 'function'
                || typeof nextSession.replaceSnapshot !== 'function'
                || !hasUsableAppearanceFields(fields)
            ) {
                failBeforeHandoff('react-appearance-state-reconcile-failed');
                return;
            }
            try {
                reconciled = nextSession.replaceSnapshot(getAppearanceSnapshot());
            } catch (error) {
                failBeforeHandoff('react-appearance-state-reconcile-failed');
                return;
            }
            if (reconciled !== true || disposed || failed) {
                failBeforeHandoff('react-appearance-state-reconcile-failed');
                return;
            }

            ready = true;
            session = nextSession;
            reactAppearanceSession = session;
            reactAppearancePreviewNode = context.preview[0];
            disableLegacyOwner();
            legacyRoot.hidden = true;
            reactRoot.hidden = false;
            owner.setAttribute('data-easymde-appearance-owner', 'react');
        }

        if (
            !owner
            || typeof owner.setAttribute !== 'function'
            || !reactRoot
            || !legacyRoot
            || !context
            || !context.preview
            || !context.preview[0]
            || !hasUsableAppearanceFields(fields)
        ) {
            reportReactAppearanceFailure('react-appearance-surface-invalid');
            return null;
        }

        restoreLegacyOwner();
        if (!reactAppearance || typeof reactAppearance.prepare !== 'function') {
            reportReactAppearanceFailure('react-appearance-entry-unavailable');
            return null;
        }
        try {
            reactAppearance = reactAppearance.prepare({
                articleThemes: themeOptions.markdownThemes || [],
                codeThemes: themeOptions.codeThemes || [],
                customCss: customCssLibrary,
                state: getAppearanceSnapshot().state,
                strings: {
                    appearance: getString('appearance'),
                    articleTheme: getString('articleTheme'),
                    codeTheme: getString('codeTheme'),
                    customCss: getString('customCss'),
                    cssName: getString('cssName'),
                    saveCss: getString('saveCss'),
                    cssSaved: getString('cssSaved'),
                    cssSaveFailed: getString('cssSaveFailed'),
                    namedCustomCss: getString('namedCustomCss')
                }
            });
        } catch (error) {
            reportReactAppearanceFailure('react-appearance-prepare-failed');
            return null;
        }
        if (!reactAppearance || typeof reactAppearance.mount !== 'function') {
            reportReactAppearanceFailure('react-appearance-contract-invalid');
            return null;
        }

        try {
            cleanup = reactAppearance.mount({
                container: reactRoot,
                port: {
                    applyState: function (nextState) {
                        if (!ready || !applyAppearanceState(nextState, context, { fields: fields })) {
                            throw new Error('react-appearance-state-invalid');
                        }
                    },
                    closeOtherPopovers: closePopovers,
                    saveCustomCss: function (input) {
                        return persistCustomCss(input).then(function () {
                            applyRenderState(context.preview, { syncFields: false });
                            syncAppearanceFields(fields);
                            context.refreshPreview({ immediate: true });
                            return {
                                status: 'saved',
                                snapshot: getAppearanceSnapshot()
                            };
                        }).catch(function (error) {
                            if (error && error.message === 'custom-css-response-invalid') {
                                reportReactAppearanceFailure('custom-css-response-invalid');
                                throw error;
                            }
                            return { status: 'failed', code: 'custom-css-save-failed' };
                        });
                    }
                },
                onFailure: function () {
                    if (disposed || failed) {
                        return;
                    }
                    failed = true;
                    if (ready) {
                        failedAfterHandoff = true;
                        reactAppearanceSession = null;
                        session = null;
                        legacyRoot.hidden = true;
                        owner.setAttribute('data-easymde-appearance-owner', 'react-reload-required');
                        reportReactAppearanceFailure('react-appearance-failed-after-handoff');
                    } else {
                        restoreLegacyOwner();
                        reportReactAppearanceFailure('react-appearance-render-failed');
                    }
                    scheduleCleanup();
                },
                onReady: function (nextSession) {
                    if (!mountComplete) {
                        pendingReadySession = nextSession;
                        return;
                    }
                    completeHandoff(nextSession);
                }
            });
        } catch (error) {
            failBeforeHandoff('react-appearance-mount-failed');
            return null;
        }
        mountComplete = true;
        if (typeof cleanup !== 'function') {
            failBeforeHandoff('react-appearance-cleanup-invalid');
            return null;
        }
        if (pendingReadySession) {
            completeHandoff(pendingReadySession);
            pendingReadySession = null;
        }
        if (typeof window.addEventListener === 'function') {
            window.addEventListener('pagehide', dispose, { once: true });
            pagehideRegistered = true;
        }
        return dispose;
    }

    function createToolbar($toolbar, context) {
        var $reactMain = $('#easymde-toolbar-react-main');
        var $main = $('#easymde-toolbar-legacy-main');
        var $secondary = $('#easymde-toolbar-legacy-secondary');
        var $reactFont;
        var $legacyFont;
        var $reactAppearance;
        var $legacyAppearance;
        var formatCommands = getGroupCommands('main', 'format');
        var blockCommands = getGroupCommands('main', 'block');
        var insertCommands = getGroupCommands('main', 'insert');
        var exportCommands = getGroupCommands('main', 'export');

        if (context.reactToolbarCleanup) {
            context.reactToolbarCleanup();
            context.reactToolbarCleanup = null;
        }
        if (context.reactFontControlsCleanup) {
            context.reactFontControlsCleanup();
            context.reactFontControlsCleanup = null;
        }
        if (context.reactAppearanceCleanup) {
            context.reactAppearanceCleanup();
            context.reactAppearanceCleanup = null;
        }

        if (!$reactMain.length || !$main.length || !$secondary.length) {
            $toolbar.empty();
            $reactMain = $('<div id="easymde-toolbar-react-main" class="easymde-toolbar-section easymde-toolbar-section-main" hidden></div>');
            $main = $('<div id="easymde-toolbar-legacy-main" class="easymde-toolbar-section easymde-toolbar-section-main"></div>');
            $secondary = $('<div id="easymde-toolbar-legacy-secondary" class="easymde-toolbar-section easymde-toolbar-section-secondary"></div>');
            $toolbar.append($reactMain, $main, $secondary);
        } else {
            $reactMain.empty().prop('hidden', true);
            $main.empty().prop('hidden', false);
            $secondary.empty();
        }

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

        createImmersiveToggleButton($secondary, context);
        $reactFont = $('<div id="easymde-toolbar-react-font" class="easymde-toolbar-popover-anchor easymde-toolbar-popover-font" hidden></div>');
        $secondary.append($reactFont);
        $legacyFont = createFontMenu($secondary, context);
        if ($legacyFont) {
            context.reactFontControlsCleanup = activateReactFontControls(
                $secondary[0],
                $reactFont[0],
                $legacyFont[0],
                context
            );
        } else {
            $reactFont.remove();
        }
        $reactAppearance = $('<div id="easymde-toolbar-react-appearance" class="easymde-toolbar-popover-anchor easymde-toolbar-popover-appearance" hidden></div>');
        $secondary.append($reactAppearance);
        $legacyAppearance = createAppearanceMenu($secondary, context);
        context.reactAppearanceCleanup = activateReactAppearance(
            $secondary[0],
            $reactAppearance[0],
            $legacyAppearance[0],
            context
        );
        context.draftStatus = createDraftStatus($secondary);

        context.reactToolbarCleanup = activateReactToolbar(
            $toolbar[0],
            $reactMain[0],
            $main[0],
            context
        );

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
            setImmersiveMode(context, !(context.immersiveWorkspace && context.immersiveWorkspace.isActive()));
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
            if (
                event.key !== 'Escape'
                || event.isComposing
                || event.keyCode === 229
                || !context.immersiveWorkspace
                || !context.immersiveWorkspace.isActive()
            ) {
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
        var $source = $('#easymde-source');
        var $reactSource = $('#easymde-source-react');
        var $reactPreviewSession = $('#easymde-preview-session-react');
        var $preview = $('#easymde-preview');
        var $content = $('#postdivrich');
        var $toolbar = $('#easymde-toolbar');
        var $sideActions = $('#easymde-side-actions');
        var $title = $('#title');
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
        var sourcePane = $source[0] ? $source[0].parentElement : null;
        var titleField = $title[0] || null;

        if (!$root.length || !$source.length || !$preview.length) {
            return;
        }

        normalPreviewNode = $preview[0];

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
            updatePreview(context.preview, $source.val(), options || { immediate: true });
        }

        context = {
            root: $root,
            textarea: $source[0],
            sourceScrollElement: $source[0],
            preview: $preview,
            refreshPreview: refreshPreview,
            flash: null,
            savedMarkdown: String($source[0].defaultValue || ''),
            savedTitle: String((titleField || {}).defaultValue || '')
        };
        context.immersiveWorkspace = createImmersiveWorkspace(context);

        function initializeEditorChrome() {
            if (editorChromeReady) {
                return;
            }

            editorChromeReady = true;
            $flash = createFlash($toolbar);
            context.flash = $flash;
            reportStartupConfigErrors($flash);
            context.reactMediaPickerCleanup = activateReactMediaPicker($root[0], context);
            $draftStatus = createToolbar($toolbar, context);
            createSideActions($sideActions, context);
            context.scrollSyncCleanup = bindScrollSync($source[0], $preview[0]);
            bindShortcuts($root, $source[0], context);
            bindImmersiveModeShortcuts(context);
            $root.attr('data-easymde-shell-ready', '1');
        }

        initializeEditorChrome();
        bindLazyImagePasteUpload($source[0], $root, $flash);
        context.onDocumentSourceReady = function (session) {
            var inputElement = session.document.getInputElement();
            var scrollElement = session.document.getScrollElement();
            var nextScrollSyncCleanup;

            if (
                !inputElement
                || typeof inputElement.addEventListener !== 'function'
                || !scrollElement
            ) {
                throw new Error('react-document-source-surface-invalid');
            }

            nextScrollSyncCleanup = bindScrollSync(scrollElement, context.preview[0]);
            try {
                bindLazyImagePasteUpload($source[0], $root, $flash, inputElement);
            } catch (error) {
                nextScrollSyncCleanup();
                throw error;
            }

            if (typeof context.scrollSyncCleanup === 'function') {
                context.scrollSyncCleanup();
            }
            context.sourceScrollElement = scrollElement;
            context.scrollSyncCleanup = nextScrollSyncCleanup;
        };
        context.onDocumentSourceDisposed = function () {
            context.sourceScrollElement = $source[0];
            restoreLegacyDocumentSource(context, $source[0], $preview[0]);
        };
        context.onPreviewSurfaceReady = function (surface) {
            var nextPreview = $(surface);
            var nextScrollSyncCleanup;

            if (!nextPreview.length) {
                throw new Error('react-preview-surface-wrapper-invalid');
            }
            nextScrollSyncCleanup = bindScrollSync(context.sourceScrollElement, surface);
            if (typeof nextScrollSyncCleanup !== 'function') {
                throw new Error('react-preview-scroll-contract-invalid');
            }
            if (typeof context.scrollSyncCleanup === 'function') {
                context.scrollSyncCleanup();
            }
            context.scrollSyncCleanup = nextScrollSyncCleanup;
            return nextPreview;
        };
        $source.on('input', function () {
            if (initialMarkdown === null) {
                sourceChangedBeforeShell = true;
            }

            mirrorToPostContent(this.value);
            updatePreview(context.preview, this.value);

            scheduleLocalDraft(
                storage,
                function () {
                    return $source.val();
                },
                function () {
                    if ($draftStatus && $draftStatus.length) {
                        $draftStatus.text(getString('draftSaved') + ' ' + window.EasyMDEDraftStorage.formatTime(Date.now()));
                    }
                }
            );
        });

        $('#post').on('submit', function () {
            skipNextCrossDocumentViewTransition();
            if (context.documentSession && typeof context.documentSession.flush === 'function') {
                context.documentSession.flush();
            }
            mirrorToPostContent($source.val());
        });
        context.reactDocumentSourceCleanup = activateReactDocumentSource(
            sourcePane,
            $reactSource[0],
            $source[0],
            titleField,
            context
        );
        context.reactPreviewSessionCleanup = activateReactPreviewSession(
            $reactPreviewSession[0],
            $root,
            $preview,
            context
        );

        afterShellPaint(function () {
            var shellMarkdown = $source.val();

            initialMarkdown = shellMarkdown;
            syncMarkdownFields(shellMarkdown);

            if (!initialPreviewHydrated) {
                updatePreview(context.preview, shellMarkdown, { immediate: true });
            }

            if (initialPreviewEnhancement) {
                if (!sourceChangedBeforeShell && context.preview[0] === $preview[0]) {
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

            consumeImmersivePublishPreview(context);

            if (getLocalDraftsEnabled()) {
                afterPreviewIdle(function () {
                    if (!sourceChangedBeforeShell && $source.val() === initialMarkdown) {
                        createDraftNotice($root, $source[0], storage, $flash);
                    }
                });
            }
        });
    }

    if (config.testHooks && window.EasyMDETestHooks) {
        window.EasyMDETestHooks.afterShellPaint = afterShellPaint;
        window.EasyMDETestHooks.copyWechat = copyWechat;
        window.EasyMDETestHooks.bindLazyImagePasteUpload = bindLazyImagePasteUpload;
        window.EasyMDETestHooks.hydrateInitialPreview = hydrateInitialPreview;
        window.EasyMDETestHooks.ensureImagePasteBound = ensureImagePasteBound;
        window.EasyMDETestHooks.openMediaPicker = openMediaPicker;
        window.EasyMDETestHooks.isSuccessfulPostNotice = isSuccessfulPostNotice;
        window.EasyMDETestHooks.readNativeCategoryOptions = readNativeCategoryOptions;
        window.EasyMDETestHooks.readNativePublishVisibility = readNativePublishVisibility;
        window.EasyMDETestHooks.applyNativePublishVisibility = applyNativePublishVisibility;
        window.EasyMDETestHooks.skipNextCrossDocumentViewTransition = skipNextCrossDocumentViewTransition;
        window.EasyMDETestHooks.getNativePublishCapabilities = getNativePublishCapabilities;
        window.EasyMDETestHooks.preflightNativePublish = preflightNativePublish;
        window.EasyMDETestHooks.getSessionStorage = getSessionStorage;
        window.EasyMDETestHooks.currentPreviewSignature = currentPreviewSignature;
        window.EasyMDETestHooks.isPreviewReady = isPreviewReady;
        window.EasyMDETestHooks.executeCommand = executeCommand;
        window.EasyMDETestHooks.bindScrollSync = bindScrollSync;
        window.EasyMDETestHooks.activateReactDocumentSource = activateReactDocumentSource;
        window.EasyMDETestHooks.activateReactPreviewSession = activateReactPreviewSession;
        window.EasyMDETestHooks.activateReactToolbar = activateReactToolbar;
        window.EasyMDETestHooks.activateReactFontControls = activateReactFontControls;
        window.EasyMDETestHooks.activateReactAppearance = activateReactAppearance;
        window.EasyMDETestHooks.activateReactMediaPicker = activateReactMediaPicker;
        window.EasyMDETestHooks.createReactMediaPickerDocumentPort = createReactMediaPickerDocumentPort;
        window.EasyMDETestHooks.applyThemeFontDefaults = applyThemeFontDefaults;
        window.EasyMDETestHooks.replaceFontState = replaceFontState;
        window.EasyMDETestHooks.applyRenderState = applyRenderState;
        window.EasyMDETestHooks.getLocalDraftsEnabled = getLocalDraftsEnabled;
        window.EasyMDETestHooks.setLocalDraftsEnabled = setLocalDraftsEnabled;
        window.EasyMDETestHooks.scheduleLocalDraft = scheduleLocalDraft;
        window.EasyMDETestHooks.enhancePreviewSurface = enhancePreviewSurface;
        window.EasyMDETestHooks.showFlash = showFlash;
        window.EasyMDETestHooks.reportStartupConfigErrors = reportStartupConfigErrors;
        window.EasyMDETestHooks.hasUnsavedDocumentChanges = hasUnsavedDocumentChanges;
        window.EasyMDETestHooks.restoreLegacyDocumentSource = restoreLegacyDocumentSource;
        window.EasyMDETestHooks.updatePreview = updatePreview;
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
