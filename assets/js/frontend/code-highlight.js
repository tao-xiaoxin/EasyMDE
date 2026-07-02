(function (window, document) {
    'use strict';

    function featureEnabled(config, key) {
        return !config || !config.features || config.features[key] !== false;
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

    function enhance(root, config) {
        if (!root) {
            return;
        }

        highlightCode(root, config || {});
        if (window.EasyMDEMathRenderer) {
            window.EasyMDEMathRenderer.render(root, config || {});
        }
        if (window.EasyMDEMermaidRenderer) {
            window.EasyMDEMermaidRenderer.render(root, config || {});
        }
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

        return next;
    }

    window.EasyMDEEnhancements = {
        enhance: enhance,
        initTheme: initTheme,
        toggleTheme: toggleTheme,
        applyTheme: applyTheme
    };
})(window, document);
