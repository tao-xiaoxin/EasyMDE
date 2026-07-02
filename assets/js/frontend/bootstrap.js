(function (window, document) {
    'use strict';

    document.addEventListener('DOMContentLoaded', function () {
        if (!window.EasyMDEEnhancements) {
            return;
        }

        window.EasyMDEEnhancements.enhance(document, window.EasyMDEFrontendConfig || {});
    });
})(window, document);
