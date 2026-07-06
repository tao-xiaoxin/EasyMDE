(function (window, document) {
    'use strict';

    var renderIndex = 0;

    function getString(config, key, fallback) {
        return config && config.strings && config.strings[key] ? config.strings[key] : (fallback || '');
    }

    function featureEnabled(config, key) {
        return !config || !config.features || config.features[key] !== false;
    }

    function init() {
        if (!window.mermaid) {
            return false;
        }

        window.mermaid.initialize({
            startOnLoad: false,
            securityLevel: 'strict',
            theme: 'default'
        });

        return true;
    }

    function render(root, config) {
        var tasks = [];

        if (!featureEnabled(config, 'mermaid') || !init()) {
            return Promise.resolve();
        }

        root.querySelectorAll('pre > code.language-mermaid:not([data-easymde-rendered])').forEach(function (code) {
            var pre = code.parentNode;
            var source = code.textContent;
            var container = document.createElement('div');
            var renderId = 'easymde-mermaid-' + Date.now() + '-' + (++renderIndex);

            container.className = 'easymde-mermaid';
            code.dataset.easymdeRendered = '1';

            tasks.push(window.mermaid.render(renderId, source).then(function (result) {
                if (!pre.parentNode) {
                    return;
                }

                container.innerHTML = result.svg;
                pre.parentNode.replaceChild(container, pre);
            }).catch(function () {
                pre.classList.add('easymde-render-error');
                pre.setAttribute('data-easymde-error', getString(config, 'renderingFailed'));
            }));
        });

        return Promise.all(tasks);
    }

    window.EasyMDEMermaidRenderer = {
        render: render
    };
})(window, document);
