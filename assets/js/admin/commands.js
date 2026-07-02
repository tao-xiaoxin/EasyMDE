(function (window) {
    'use strict';

    function buildCommandMap(commands) {
        var map = {};

        (commands || []).forEach(function (command) {
            if (command && command.id) {
                map[String(command.id)] = command;
            }
        });

        return map;
    }

    function getCommand(commandMap, id) {
        return commandMap[id] || null;
    }

    function getSurfaceCommands(commandMap, surface) {
        return Object.keys(commandMap).map(function (id) {
            return commandMap[id];
        }).filter(function (command) {
            return command.surface === surface;
        });
    }

    function getGroupCommands(commandMap, surface, group) {
        return getSurfaceCommands(commandMap, surface).filter(function (command) {
            return command.group === group;
        });
    }

    function getShortcutForCommand(shortcuts, commandId, isMac) {
        var shortcut = (shortcuts || {})[commandId] || {};

        return isMac ? (shortcut.mac || '') : (shortcut.win || '');
    }

    function getCommandLabel(command) {
        return command && command.label ? command.label : (command ? command.id : '');
    }

    function applyTextChange(textarea, value, selectionStart, selectionEnd, services) {
        var scrollTop = textarea.scrollTop;
        var scrollLeft = textarea.scrollLeft;
        var windowScrollX = window.pageXOffset;
        var windowScrollY = window.pageYOffset;

        textarea.value = value;
        services.focusWithoutScrolling(textarea);

        if (typeof selectionStart === 'number' && typeof selectionEnd === 'number') {
            textarea.selectionStart = selectionStart;
            textarea.selectionEnd = selectionEnd;
        }

        services.restoreScrollPosition(textarea, scrollTop, scrollLeft);
        window.scrollTo(windowScrollX, windowScrollY);
        services.$(textarea).trigger('input');
        window.setTimeout(function () {
            services.restoreScrollPosition(textarea, scrollTop, scrollLeft);
            window.scrollTo(windowScrollX, windowScrollY);
        }, 0);
    }

    function insertAround(textarea, prefix, suffix, placeholder, services) {
        var start = textarea.selectionStart;
        var end = textarea.selectionEnd;
        var value = textarea.value;
        var selected = value.slice(start, end) || (placeholder || '');
        var replacement = prefix + selected + suffix;

        applyTextChange(
            textarea,
            value.slice(0, start) + replacement + value.slice(end),
            start + prefix.length,
            start + prefix.length + selected.length,
            services
        );
    }

    function transformSelectedLines(textarea, transform, services) {
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
            lineStart + replacement.length,
            services
        );
    }

    function stripLineMarkup(line) {
        return String(line)
            .replace(/^\s{0,3}#{1,6}\s+/, '')
            .replace(/^\s{0,3}>\s?/, '')
            .replace(/^\s{0,3}(?:[-+*]\s+|\d+\.\s+)/, '');
    }

    function applyLinePrefix(textarea, prefix, services) {
        transformSelectedLines(textarea, function (lines) {
            return lines.map(function (line) {
                if (!line) {
                    return prefix.trim();
                }

                return prefix + stripLineMarkup(line);
            });
        }, services);
    }

    function applyOrderedList(textarea, services) {
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
        }, services);
    }

    function setHeadingLevel(textarea, level, services) {
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
        }, services);
    }

    function insertBlock(textarea, prefix, suffix, placeholder, services) {
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
            start + blockPrefix.length + content.length,
            services
        );
    }

    window.EasyMDECommands = {
        buildCommandMap: buildCommandMap,
        getCommand: getCommand,
        getSurfaceCommands: getSurfaceCommands,
        getGroupCommands: getGroupCommands,
        getShortcutForCommand: getShortcutForCommand,
        getCommandLabel: getCommandLabel,
        applyTextChange: applyTextChange,
        insertAround: insertAround,
        applyLinePrefix: applyLinePrefix,
        applyOrderedList: applyOrderedList,
        setHeadingLevel: setHeadingLevel,
        insertBlock: insertBlock
    };
})(window);
