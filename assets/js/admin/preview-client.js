(function (window) {
    'use strict';

    function createFallback(markdown, emptyText, escapeHtml) {
        if (!markdown.trim()) {
            return '<p class="easymde-preview-empty">' + escapeHtml(emptyText || '') + '</p>';
        }

        return '<pre class="easymde-preview-fallback">' + escapeHtml(markdown) + '</pre>';
    }

    function captureScroll(preview) {
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

    window.EasyMDEPreviewClient = {
        createFallback: createFallback,
        captureScroll: captureScroll
    };
})(window);
