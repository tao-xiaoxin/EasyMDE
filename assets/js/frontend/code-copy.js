(function (window, document) {
    'use strict';

    var RESET_DELAY = 2000;

    function copyWithFallback(text) {
        var textarea;
        var copied;
        var previousFocus = document.activeElement;

        if (!document.body || typeof document.execCommand !== 'function') {
            return Promise.reject(new Error('Clipboard API is unavailable.'));
        }

        textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.setAttribute('aria-hidden', 'true');
        textarea.className = 'easymde-code-copy__fallback';
        document.body.appendChild(textarea);
        textarea.select();

        try {
            copied = document.execCommand('copy');
        } finally {
            document.body.removeChild(textarea);
            if (previousFocus && typeof previousFocus.focus === 'function') {
                previousFocus.focus();
            }
        }

        return copied ? Promise.resolve() : Promise.reject(new Error('The browser rejected the copy command.'));
    }

    function copyText(text) {
        if (window.navigator.clipboard && typeof window.navigator.clipboard.writeText === 'function') {
            return window.navigator.clipboard.writeText(text);
        }

        return copyWithFallback(text);
    }

    function setButtonState(button, label) {
        button.textContent = label;
        button.setAttribute('aria-label', label);
    }

    function addCopyButton(code, strings) {
        var pre = code.parentNode;
        var button;
        var source = code.textContent;

        if (!pre || pre.querySelector(':scope > .easymde-code-copy__button')) {
            return;
        }

        button = document.createElement('button');
        button.type = 'button';
        button.className = 'easymde-code-copy__button';
        setButtonState(button, strings.copyCode);
        pre.className = (pre.className ? pre.className + ' ' : '') + 'easymde-code-copy';
        pre.insertBefore(button, code);

        button.addEventListener('click', function () {
            return copyText(source).then(function () {
                setButtonState(button, strings.copied);
            }).catch(function () {
                setButtonState(button, strings.copyFailed);
            }).then(function () {
                window.setTimeout(function () {
                    setButtonState(button, strings.copyCode);
                }, RESET_DELAY);
            });
        });
    }

    function enhance(root, config) {
        var strings;

        if (!root || !root.querySelectorAll) {
            return;
        }

        strings = (config && config.strings) || {};
        strings = {
            copyCode: strings.copyCode || 'Copy code',
            copied: strings.copied || 'Copied',
            copyFailed: strings.copyFailed || 'Copy failed'
        };

        root.querySelectorAll('.easymde-rendered-content pre > code:not(.language-mermaid)').forEach(function (code) {
            addCopyButton(code, strings);
        });

        if (root.matches && root.matches('.easymde-rendered-content')) {
            root.querySelectorAll('pre > code:not(.language-mermaid)').forEach(function (code) {
                addCopyButton(code, strings);
            });
        }
    }

    window.EasyMDECodeCopy = { enhance: enhance };
})(window, document);
