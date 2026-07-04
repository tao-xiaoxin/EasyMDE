(function (window, document) {
    'use strict';

    var renderIndex = 0;

    function getString(config, key, fallback) {
        return config && config.strings && config.strings[key] ? config.strings[key] : (fallback || '');
    }

    function featureEnabled(config, key) {
        return !config || !config.features || config.features[key] !== false;
    }

    function isDark(root) {
        return !!(root && root.closest && root.closest('.easymde-theme-dark'));
    }

    function init(root) {
        if (!window.mermaid) {
            return false;
        }

        window.mermaid.initialize({
            startOnLoad: false,
            securityLevel: 'strict',
            theme: isDark(root) ? 'dark' : 'default'
        });

        return true;
    }

    function render(root, config) {
        if (!featureEnabled(config, 'mermaid') || !init(root)) {
            return;
        }

        root.querySelectorAll('pre > code.language-mermaid:not([data-easymde-rendered])').forEach(function (code) {
            var pre = code.parentNode;
            var source = code.textContent;
            var container = document.createElement('div');
            var renderId = 'easymde-mermaid-' + Date.now() + '-' + (++renderIndex);

            container.className = 'easymde-mermaid';
            code.dataset.easymdeRendered = '1';

            window.mermaid.render(renderId, source).then(function (result) {
                if (!pre.parentNode) {
                    return;
                }

                container.innerHTML = result.svg;
                pre.parentNode.replaceChild(container, pre);
            }).catch(function () {
                pre.classList.add('easymde-render-error');
                pre.setAttribute('data-easymde-error', getString(config, 'renderingFailed'));
            });
        });
    }

    window.EasyMDEMermaidRenderer = {
        render: render
    };
})(window, document);
