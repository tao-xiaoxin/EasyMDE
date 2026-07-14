(function (window) {
    'use strict';

    function open(textarea, options) {
        options = options || {};
        var inserted = false;

        function restoreSelection() {
            var selection = options.selection;
            if (!selection) {
                return;
            }
            textarea.setSelectionRange(selection.start, selection.end);
            textarea.scrollTop = selection.scrollTop;
            textarea.scrollLeft = selection.scrollLeft;
        }

        if (!window.wp || !window.wp.media) {
            restoreSelection();
            options.insertAround(textarea, '![' + (options.altText || '') + '](', ')');
            if (typeof options.commitSourceChange === 'function') {
                options.commitSourceChange();
            }
            if (typeof options.notifyInput === 'function') {
                options.notifyInput();
            }
            if (typeof options.restoreFocus === 'function') {
                options.restoreFocus();
            }
            return;
        }

        var frame = window.wp.media({
            title: options.title || '',
            multiple: false
        });

        frame.on('select', function () {
            var attachment = frame.state().get('selection').first().toJSON();
            var alt = attachment.alt || attachment.title || options.defaultAlt || '';
            var markdown = '![' + alt + '](' + attachment.url + ')';
            restoreSelection();
            var start = textarea.selectionStart;
            var end = textarea.selectionEnd;
            var value = textarea.value;

            options.applyTextChange(
                textarea,
                value.slice(0, start) + markdown + value.slice(end),
                start + markdown.length,
                start + markdown.length
            );
            if (typeof options.commitSourceChange === 'function') {
                options.commitSourceChange();
            }
            inserted = true;
            if (typeof options.notifyInput === 'function') {
                options.notifyInput();
            }
        });

        frame.on('close', function () {
            if (!inserted) {
                restoreSelection();
            }
            if (typeof options.restoreFocus === 'function') {
                options.restoreFocus();
            }
        });

        frame.open();
    }

    window.EasyMDEMediaPicker = {
        open: open
    };
})(window);
