(function (window, document) {
    'use strict';

    function featureEnabled(config, key) {
        return !config || !config.features || config.features[key] !== false;
    }

    function syncCodeFrameBackgrounds(root) {
        root.querySelectorAll('pre > code:not(.language-mermaid)').forEach(function (code) {
            code.parentElement.style.setProperty(
                '--easymde-code-frame-background',
                window.getComputedStyle(code).backgroundColor
            );
        });
    }

    function highlightCode(root, config) {
        var syntaxHighlight = featureEnabled(config, 'syntaxHighlight');

        root.querySelectorAll('pre > code').forEach(function (code) {
            if (code.classList.contains('language-mermaid')) {
                return;
            }

            code.classList.add('hljs');
            if (!syntaxHighlight || !window.hljs || code.dataset.easymdeHighlighted) {
                return;
            }

            window.hljs.highlightElement(code);
            code.dataset.easymdeHighlighted = '1';
        });
        syncCodeFrameBackgrounds(root);
    }

    function enhance(root, config) {
        var tasks = [];

        if (!root) {
            return Promise.resolve();
        }

        highlightCode(root, config || {});
        if (window.EasyMDEMathRenderer) {
            tasks.push(window.EasyMDEMathRenderer.render(root, config || {}));
        }
        if (window.EasyMDEMermaidRenderer) {
            tasks.push(window.EasyMDEMermaidRenderer.render(root, config || {}));
        }

        return Promise.all(tasks);
    }

	window.EasyMDEEnhancements = {
		enhance: enhance
	};
})(window, document);
