(function (window, document) {
    'use strict';

    document.addEventListener('DOMContentLoaded', function () {
        var config = window.EasyMDEFrontendConfig || {};

        if (!window.EasyMDEEnhancements) {
            return;
        }

        window.EasyMDEEnhancements.enhance(document, config);

    });
})(window, document);
