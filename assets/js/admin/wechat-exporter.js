(function (window, document) {
    'use strict';

    var COPY_STYLE_PROPS = [
        'display',
        'position',
        'float',
        'clear',
        'box-sizing',
        'overflow',
        'overflow-x',
        'overflow-y',
        'width',
        'max-width',
        'min-width',
        'height',
        'max-height',
        'min-height',
        'margin-top',
        'margin-right',
        'margin-bottom',
        'margin-left',
        'padding-top',
        'padding-right',
        'padding-bottom',
        'padding-left',
        'border-top-width',
        'border-right-width',
        'border-bottom-width',
        'border-left-width',
        'border-top-style',
        'border-right-style',
        'border-bottom-style',
        'border-left-style',
        'border-top-color',
        'border-right-color',
        'border-bottom-color',
        'border-left-color',
        'border-collapse',
        'border-spacing',
        'border-radius',
        'background',
        'background-color',
        'color',
        'font',
        'font-family',
        'font-size',
        'font-style',
        'font-weight',
        'line-height',
        'letter-spacing',
        'text-align',
        'text-decoration',
        'text-transform',
        'text-indent',
        'white-space',
        'word-break',
        'overflow-wrap',
        'vertical-align',
        'list-style-type',
        'list-style-position',
        'box-shadow',
        'tab-size'
    ];

    function shouldKeepStyle(prop, value, sourceNode) {
        if (!value) {
            return false;
        }

        if (value === 'rgba(0, 0, 0, 0)' && prop !== 'color') {
            return false;
        }

        if (value === 'normal' && (prop === 'letter-spacing' || prop === 'font-style' || prop === 'text-transform')) {
            return false;
        }

        if (value === 'auto' && (prop === 'width' || prop === 'height')) {
            return false;
        }

        if (sourceNode.tagName === 'A' && prop === 'text-decoration' && value === 'none') {
            return false;
        }

        return true;
    }

    function inlineStyles(sourceNode, cloneNode) {
        if (!sourceNode || !cloneNode || sourceNode.nodeType !== 1 || cloneNode.nodeType !== 1) {
            return;
        }

        var computed = window.getComputedStyle(sourceNode);
        var declarations = [];

        COPY_STYLE_PROPS.forEach(function (prop) {
            var value = computed.getPropertyValue(prop);

            if (shouldKeepStyle(prop, value, sourceNode)) {
                declarations.push(prop + ':' + value);
            }
        });

        if (declarations.length) {
            cloneNode.setAttribute('style', declarations.join(';'));
        }

        cloneNode.removeAttribute('class');
        cloneNode.removeAttribute('id');
        cloneNode.removeAttribute('aria-live');
        cloneNode.removeAttribute('data-easymde-highlighted');
        cloneNode.removeAttribute('data-easymde-rendered');

        Array.prototype.forEach.call(sourceNode.childNodes, function (child, index) {
            inlineStyles(child, cloneNode.childNodes[index]);
        });
    }

    function createClipboardMarkup(preview) {
        if (!preview) {
            return null;
        }

        var clone = preview.cloneNode(true);

        clone.querySelectorAll('script, style').forEach(function (node) {
            node.parentNode.removeChild(node);
        });

        inlineStyles(preview, clone);
        clone.setAttribute('style', (clone.getAttribute('style') || '') + ';max-width:100%;margin:0 auto;');

        return clone;
    }

    function legacyCopyHtml(html) {
        var selection = window.getSelection();
        var ranges = [];
        var container = document.createElement('div');
        var range = document.createRange();
        var scrollX = window.pageXOffset;
        var scrollY = window.pageYOffset;
        var success = false;

        container.className = 'easymde-copy-sandbox';
        container.setAttribute('contenteditable', 'true');
        container.innerHTML = html;
        document.body.appendChild(container);

        if (selection) {
            for (var index = 0; index < selection.rangeCount; index += 1) {
                ranges.push(selection.getRangeAt(index));
            }

            selection.removeAllRanges();
            range.selectNodeContents(container);
            selection.addRange(range);
        }

        try {
            success = document.execCommand('copy');
        } catch (error) {
            success = false;
        }

        if (selection) {
            selection.removeAllRanges();
            ranges.forEach(function (storedRange) {
                selection.addRange(storedRange);
            });
        }

        document.body.removeChild(container);
        window.scrollTo(scrollX, scrollY);

        return success;
    }

    function previewIsRefreshing(preview) {
        if (!preview || typeof preview.getAttribute !== 'function') {
            return false;
        }

        return preview.getAttribute('data-easymde-preview-refreshing') === '1'
            || preview.getAttribute('aria-busy') === 'true';
    }

    function copy(context, callbacks) {
        callbacks = callbacks || {};

        var getString = callbacks.getString || function (key, fallback) {
            return fallback || '';
        };
        var showFlash = callbacks.showFlash || function () {};
        var preview = context && context.preview ? context.preview : document.getElementById('easymde-preview');
        var flash = context && context.flash ? context.flash : null;
        var clone;
        var html;
        var text;

        if (preview && preview.jquery) {
            preview = preview[0];
        }

        if (
            !preview
            || !preview.innerHTML.trim()
            || preview.querySelector('.easymde-preview-pending')
            || previewIsRefreshing(preview)
        ) {
            showFlash(flash, 'error', getString('copyWechatFailed'));
            return;
        }

        clone = createClipboardMarkup(preview);
        if (!clone) {
            showFlash(flash, 'error', getString('copyWechatFailed'));
            return;
        }

        html = clone.outerHTML;
        text = preview.innerText || preview.textContent || '';

        if (window.navigator.clipboard && window.ClipboardItem && window.Blob) {
            window.navigator.clipboard.write([
                new window.ClipboardItem({
                    'text/html': new window.Blob([html], { type: 'text/html' }),
                    'text/plain': new window.Blob([text], { type: 'text/plain' })
                })
            ]).then(function () {
                showFlash(flash, 'success', getString('copyWechatSuccess'));
            }).catch(function () {
                if (legacyCopyHtml(html)) {
                    showFlash(flash, 'success', getString('copyWechatSuccess'));
                    return;
                }

                showFlash(flash, 'error', getString('copyWechatFailed'));
            });

            return;
        }

        if (legacyCopyHtml(html)) {
            showFlash(flash, 'success', getString('copyWechatSuccess'));
            return;
        }

        showFlash(flash, 'error', getString('copyWechatUnsupported'));
    }

    window.EasyMDEWechatExporter = {
        copy: copy
    };
})(window, document);
