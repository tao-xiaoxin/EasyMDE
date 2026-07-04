(function (window) {
    'use strict';

    function firstImageFile(event) {
        var clipboard = event && event.clipboardData ? event.clipboardData : null;
        var items = clipboard && clipboard.items ? clipboard.items : [];
        var files = clipboard && clipboard.files ? clipboard.files : [];
        var index;
        var file;

        for (index = 0; index < items.length; index += 1) {
            if (!items[index] || items[index].kind !== 'file' || !/^image\//i.test(items[index].type || '')) {
                continue;
            }

            file = typeof items[index].getAsFile === 'function' ? items[index].getAsFile() : null;
            if (file) {
                return file;
            }
        }

        for (index = 0; index < files.length; index += 1) {
            file = files[index];
            if (file && /^image\//i.test(file.type || '')) {
                return file;
            }
        }

        return null;
    }

    function canUpload(config) {
        return !!(
            config
            && config.imageUpload
            && config.imageUpload.enabled
            && config.imageUploadUrl
            && config.nonce
            && window.wp
            && window.wp.apiFetch
            && window.FormData
        );
    }

    function escapeAltText(value) {
        return String(value || '')
            .replace(/[\r\n\t]+/g, ' ')
            .replace(/[\[\]]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function imageMarkdown(upload, fallbackAlt) {
        var alt = escapeAltText(upload && upload.alt ? upload.alt : fallbackAlt);
        var url = String(upload && upload.url ? upload.url : '').replace(/\)/g, '%29');

        if (!url) {
            return '';
        }

        return '![' + alt + '](' + url + ')';
    }

    function defaultAltFromFile(file, fallback) {
        var name = file && file.name ? String(file.name) : '';

        if (!name) {
            return fallback || '';
        }

        return name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
    }

    function uploadFileName(file) {
        var name = file && file.name ? String(file.name) : 'pasted-image';
        var extensionByType = {
            'image/gif': 'gif',
            'image/jpeg': 'jpg',
            'image/jpg': 'jpg',
            'image/png': 'png',
            'image/webp': 'webp'
        };
        var extension = extensionByType[String(file && file.type ? file.type : '').toLowerCase()] || 'png';

        if (/\.(?:gif|jpe?g|png|webp)$/i.test(name)) {
            return name;
        }

        return name + '.' + extension;
    }

    function selectedRange(textarea) {
        var fallback = textarea && typeof textarea.value === 'string' ? textarea.value.length : 0;
        var start = textarea && typeof textarea.selectionStart === 'number' ? textarea.selectionStart : fallback;
        var end = textarea && typeof textarea.selectionEnd === 'number' ? textarea.selectionEnd : start;

        return {
            start: start,
            end: end
        };
    }

    function insertAtCursor(textarea, markdown, applyTextChange, range) {
        var value = textarea.value;
        var selection = range || selectedRange(textarea);
        var start = Math.max(0, Math.min(selection.start, value.length));
        var end = Math.max(start, Math.min(selection.end, value.length));
        var nextValue = textarea.value.slice(0, start) + markdown + textarea.value.slice(end);

        if (typeof applyTextChange === 'function') {
            applyTextChange(textarea, nextValue, start + markdown.length, start + markdown.length);
            return;
        }

        textarea.value = nextValue;
        textarea.selectionStart = start + markdown.length;
        textarea.selectionEnd = start + markdown.length;

        if (typeof textarea.dispatchEvent === 'function' && window.Event) {
            textarea.dispatchEvent(new window.Event('input', { bubbles: true }));
        }
    }

    function uploadImage(file, options) {
        var config = options.config || {};
        var formData = new window.FormData();
        var postId = options.postId || 0;
        var fallbackAlt = defaultAltFromFile(file, options.defaultAlt || '');

        formData.append('file', file, uploadFileName(file));
        formData.append('post_id', String(postId));
        formData.append('alt_text', fallbackAlt);

        return window.wp.apiFetch({
            url: config.imageUploadUrl,
            method: 'POST',
            headers: {
                'X-WP-Nonce': config.nonce
            },
            body: formData
        });
    }

    function handlePaste(event, textarea, options) {
        var file = firstImageFile(event);
        var config;
        var showFlash;
        var getString;
        var markdownDefaultAlt;
        var pasteRange;

        options = options || {};
        config = options.config || {};
        showFlash = options.showFlash || function () {};
        getString = options.getString || function (key, fallback) {
            return fallback || key || '';
        };
        markdownDefaultAlt = getString('mediaDefaultAlt', 'image');

        if (!file || !canUpload(config)) {
            return false;
        }

        if (config.imageUpload.maxBytes && file.size > config.imageUpload.maxBytes) {
            event.preventDefault();
            showFlash(options.flash, 'error', getString('imagePasteTooLarge'));
            return Promise.resolve(false);
        }

        event.preventDefault();
        pasteRange = selectedRange(textarea);
        showFlash(options.flash, 'info', getString('imagePasteUploading'));

        return uploadImage(file, {
            config: config,
            defaultAlt: markdownDefaultAlt,
            postId: options.postId || 0
        }).then(function (upload) {
            var markdown = imageMarkdown(upload, markdownDefaultAlt);

            if (!markdown) {
                throw new Error('Missing uploaded image URL.');
            }

            insertAtCursor(textarea, markdown, options.applyTextChange, pasteRange);
            showFlash(options.flash, 'success', getString('imagePasteUploaded'));
            return upload;
        }).catch(function () {
            showFlash(options.flash, 'error', getString('imagePasteFailed'));
            return false;
        });
    }

    function bind(textarea, options) {
        if (!textarea || textarea.easymdeImagePasteBound || typeof textarea.addEventListener !== 'function') {
            return;
        }

        textarea.easymdeImagePasteBound = true;
        textarea.addEventListener('paste', function (event) {
            handlePaste(event, textarea, options);
        });
    }

    window.EasyMDEImagePaste = {
        bind: bind,
        firstImageFile: firstImageFile,
        handlePaste: handlePaste,
        imageMarkdown: imageMarkdown
    };
})(window);
