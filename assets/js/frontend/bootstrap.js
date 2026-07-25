(function (window, document) {
    'use strict';

    document.addEventListener('DOMContentLoaded', function () {
        var config = window.EasyMDEFrontendConfig || {};

        if (!window.EasyMDEEnhancements) {
            return;
        }

        window.EasyMDEEnhancements.enhance(document, config);

        if (!config.features || !config.features.codeCopy) {
            return;
        }

        if (!window.EasyMDECodeCopy) {
            throw new Error('easymde-code-copy-owner-missing');
        }

        window.EasyMDECodeCopy.enhance(document, config);
    });
})(window, document);
