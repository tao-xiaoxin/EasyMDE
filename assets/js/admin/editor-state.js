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

    window.EasyMDEEditorState = {
        detectMacPlatform: detectMacPlatform,
        findById: findById,
        escapeHtml: escapeHtml,
        focusWithoutScrolling: focusWithoutScrolling,
        restoreScrollPosition: restoreScrollPosition,
        replaceClassPrefix: replaceClassPrefix
    };
})(window);
