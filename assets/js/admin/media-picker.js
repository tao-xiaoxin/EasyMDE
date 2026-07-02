(function (window) {
    'use strict';

    function open(textarea, options) {
        options = options || {};

        if (!window.wp || !window.wp.media) {
            options.insertAround(textarea, '![alt text](', ')');
            return;
        }

        var frame = window.wp.media({
            title: options.title || 'Insert Media',
            multiple: false
        });

        frame.on('select', function () {
            var attachment = frame.state().get('selection').first().toJSON();
            var alt = attachment.alt || attachment.title || 'image';
            var markdown = '![' + alt + '](' + attachment.url + ')';
            var start = textarea.selectionStart;
            var end = textarea.selectionEnd;
            var value = textarea.value;

            options.applyTextChange(
                textarea,
                value.slice(0, start) + markdown + value.slice(end),
                start + markdown.length,
                start + markdown.length
            );
        });

        frame.open();
    }

    window.EasyMDEMediaPicker = {
        open: open
    };
})(window);
