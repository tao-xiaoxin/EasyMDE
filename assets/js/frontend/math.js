(function (window) {
    'use strict';

    function featureEnabled(config, key) {
        return !config || !config.features || config.features[key] !== false;
    }

    function normalizeMathTex(tex) {
        if (!tex) {
            return tex;
        }

        tex = tex
            .replace(/(^|[^A-Za-z\\])(begin|end)(?=\s*\{)/g, '$1\\$2')
            .replace(/(^|[^A-Za-z\\])(frac|dfrac|tfrac|binom|sqrt)(?=\s*\{)/g, '$1\\$2')
            .replace(/(^|[^A-Za-z\\])(left|right)(?=\s*(?:[()[\]{}|.]|\\[{}]))/g, '$1\\$2')
            .replace(/(^|[^A-Za-z\\])(log|ln|exp|lim|sin|cos|tan|cot|sec|csc|min|max|sup|inf)(?![A-Za-z])/g, '$1\\$2')
            .replace(/(^|[^A-Za-z\\])(cdots|ldots|dots|vdots|ddots|cdot|times|div|pm|mp|leq|geq|neq|approx|infty)(?![A-Za-z])/g, '$1\\$2');

        return tex.replace(/\\begin\{([A-Za-z]*matrix|array)\}([\s\S]*?)\\end\{\1\}/g, function (match, environment, body) {
            return '\\begin{' + environment + '}' + body.replace(/(^|[^\\])\\(?![\\A-Za-z{])/g, '$1\\\\') + '\\end{' + environment + '}';
        });
    }

    function mathText(element) {
        var value = element.textContent.trim();

        if (value.slice(0, 2) === '$$' && value.slice(-2) === '$$') {
            return normalizeMathTex(value.slice(2, -2).trim());
        }

        if (value.slice(0, 2) === '\\(' && value.slice(-2) === '\\)') {
            return normalizeMathTex(value.slice(2, -2).trim());
        }

        return normalizeMathTex(value);
    }

    function render(root, config) {
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

    window.EasyMDEMathRenderer = {
        render: render
    };
})(window);
