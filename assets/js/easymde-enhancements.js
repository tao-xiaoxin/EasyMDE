(function (window, document) {
    'use strict';

    var mermaidReady = false;
    var renderIndex = 0;

    function getString(config, key, fallback) {
        return config && config.strings && config.strings[key] ? config.strings[key] : fallback;
    }

    function featureEnabled(config, key) {
        return !config || !config.features || config.features[key] !== false;
    }

    function isDark(root) {
        return !!(root && root.closest && root.closest('.easymde-theme-dark'));
    }

    function normalizeFullstackBlueHighlight(code) {
        var highlighted;
        var builtInTokens = {
            'let': true,
            'log': true,
            'return': true,
            'source': true,
            'type': true
        };
        var plainTokens = {
            'boolean': true,
            'class': true,
            'const': true,
            'extends': true,
            'implements': true,
            'interface': true,
            'keyof': true,
            'new': true,
            'number': true,
            'string': true,
            'void': true
        };

        if (!code.closest || !code.closest('.easymde-markdown-theme-fullstack-blue')) {
            return;
        }

        highlighted = code.querySelectorAll('.hljs-built_in, .hljs-keyword, .hljs-meta, .hljs-number, .hljs-title, .hljs-type');
        highlighted.forEach(function (span) {
            var token = span.textContent.trim();

            span.classList.remove('easymde-mdnice-built-in', 'easymde-mdnice-keyword', 'easymde-mdnice-plain');

            if (builtInTokens[token]) {
                span.classList.add('easymde-mdnice-built-in');
                return;
            }

            if ('function' === token) {
                span.classList.add('easymde-mdnice-keyword');
                return;
            }

            if (plainTokens[token] || span.classList.contains('hljs-title') || span.classList.contains('hljs-meta') || span.classList.contains('hljs-number')) {
                span.classList.add('easymde-mdnice-plain');
            }
        });
    }

    function highlightCode(root, config) {
        if (!featureEnabled(config, 'syntaxHighlight') || !window.hljs) {
            return;
        }

        root.querySelectorAll('pre > code').forEach(function (code) {
            if (code.classList.contains('language-mermaid') || code.dataset.easymdeHighlighted) {
                return;
            }

            window.hljs.highlightElement(code);
            normalizeFullstackBlueHighlight(code);
            code.dataset.easymdeHighlighted = '1';
        });
    }

    function mathText(element) {
        var value = element.textContent.trim();

        if (value.slice(0, 2) === '$$' && value.slice(-2) === '$$') {
            return value.slice(2, -2).trim();
        }

        if (value.slice(0, 2) === '\\(' && value.slice(-2) === '\\)') {
            return value.slice(2, -2).trim();
        }

        return value;
    }

    function renderMath(root, config) {
        if (!featureEnabled(config, 'math') || !window.katex) {
            return;
        }

        root.querySelectorAll('.easymde-math:not([data-easymde-rendered])').forEach(function (element) {
            var displayMode = element.classList.contains('easymde-math-block');

            try {
                window.katex.render(mathText(element), element, {
                    displayMode: displayMode,
                    throwOnError: false,
                    strict: 'warn'
                });
                element.dataset.easymdeRendered = '1';
            } catch (error) {
                element.classList.add('easymde-render-error');
                element.dataset.easymdeRendered = '1';
            }
        });
    }

    function initMermaid(root, config) {
        if (!window.mermaid) {
            return false;
        }

        window.mermaid.initialize({
            startOnLoad: false,
            securityLevel: 'strict',
            theme: isDark(root) ? 'dark' : 'default'
        });

        mermaidReady = true;

        return true;
    }

    function renderMermaid(root, config) {
        if (!featureEnabled(config, 'mermaid') || !initMermaid(root, config)) {
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
                container.innerHTML = result.svg;
                pre.parentNode.replaceChild(container, pre);
            }).catch(function () {
                pre.classList.add('easymde-render-error');
                pre.setAttribute('data-easymde-error', getString(config, 'renderingFailed', 'Rendering failed.'));
            });
        });
    }

    function enhance(root, config) {
        if (!root) {
            return;
        }

        highlightCode(root, config || {});
        renderMath(root, config || {});
        renderMermaid(root, config || {});
    }

    function storedTheme(config) {
        var key = config && config.storage && config.storage.themeKey;

        if (!key) {
            return '';
        }

        try {
            return window.localStorage.getItem(key) || '';
        } catch (error) {
            return '';
        }
    }

    function saveTheme(config, theme) {
        var key = config && config.storage && config.storage.themeKey;

        if (!key) {
            return;
        }

        try {
            window.localStorage.setItem(key, theme);
        } catch (error) {}
    }

    function applyTheme(root, theme) {
        if (!root) {
            return 'light';
        }

        root.classList.toggle('easymde-theme-dark', theme === 'dark');
        root.classList.toggle('easymde-theme-light', theme !== 'dark');

        return theme === 'dark' ? 'dark' : 'light';
    }

    function initTheme(root, config) {
        var theme = storedTheme(config);

        if (!theme && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            theme = 'dark';
        }

        return applyTheme(root, theme === 'dark' ? 'dark' : 'light');
    }

    function toggleTheme(root, config) {
        var next = root && root.classList.contains('easymde-theme-dark') ? 'light' : 'dark';

        applyTheme(root, next);
        saveTheme(config, next);

        mermaidReady = false;

        return next;
    }

    window.EasyMDEEnhancements = {
        enhance: enhance,
        initTheme: initTheme,
        toggleTheme: toggleTheme,
        applyTheme: applyTheme
    };
})(window, document);
