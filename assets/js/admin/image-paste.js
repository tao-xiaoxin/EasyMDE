(function (window) {
    'use strict';

    function eventTransfer(event) {
        return event && (event.clipboardData || event.dataTransfer) ? event.clipboardData || event.dataTransfer : null;
    }

    function hasImageFileTransfer(transfer) {
        var items = transfer && transfer.items ? transfer.items : [];
        var files = transfer && transfer.files ? transfer.files : [];
        var index;
        var type;
        var file;

        for (index = 0; index < items.length; index += 1) {
            if (!items[index] || items[index].kind !== 'file') {
                continue;
            }

            type = items[index].type || '';
            if (/^image\//i.test(type)) {
                return true;
            }
        }

        for (index = 0; index < files.length; index += 1) {
            file = files[index];
            if (file && /^image\//i.test(file.type || '')) {
                return true;
            }
        }

        return false;
    }

    function firstImageFileFromTransfer(transfer) {
        var items = transfer && transfer.items ? transfer.items : [];
        var files = transfer && transfer.files ? transfer.files : [];
        var index;
        var file;
        var itemType;

        for (index = 0; index < items.length; index += 1) {
            if (!items[index] || items[index].kind !== 'file') {
                continue;
            }

            itemType = items[index].type || '';
            if (itemType && !/^image\//i.test(itemType)) {
                continue;
            }

            file = typeof items[index].getAsFile === 'function' ? items[index].getAsFile() : null;
            if (file && /^image\//i.test(file.type || itemType)) {
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

    function firstImageFile(event) {
        return firstImageFileFromTransfer(eventTransfer(event));
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

    function preventDefault(event) {
        if (event && typeof event.preventDefault === 'function') {
            event.preventDefault();
        }
    }

    function uploadString(getString, source, suffix) {
        if (source === 'drop') {
            if (suffix === 'TooLarge') {
                return getString('imageDropTooLarge') || getString('imagePasteTooLarge');
            }

            if (suffix === 'Uploading') {
                return getString('imageDropUploading') || getString('imagePasteUploading');
            }

            if (suffix === 'Uploaded') {
                return getString('imageDropUploaded') || getString('imagePasteUploaded');
            }

            if (suffix === 'Failed') {
                return getString('imageDropFailed') || getString('imagePasteFailed');
            }
        }

        if (suffix === 'TooLarge') {
            return getString('imagePasteTooLarge');
        }

        if (suffix === 'Uploading') {
            return getString('imagePasteUploading');
        }

        if (suffix === 'Uploaded') {
            return getString('imagePasteUploaded');
        }

        if (suffix === 'Failed') {
            return getString('imagePasteFailed');
        }

        return '';
    }

    function handleImageFile(file, event, textarea, options, source) {
        var config;
        var showFlash;
        var getString;
        var markdownDefaultAlt;
        var insertionRange;

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
            preventDefault(event);
            showFlash(options.flash, 'error', uploadString(getString, source, 'TooLarge'));
            return Promise.resolve(false);
        }

        preventDefault(event);
        insertionRange = selectedRange(textarea);
        showFlash(options.flash, 'info', uploadString(getString, source, 'Uploading'));

        return uploadImage(file, {
            config: config,
            defaultAlt: markdownDefaultAlt,
            postId: options.postId || 0
        }).then(function (upload) {
            var markdown = imageMarkdown(upload, markdownDefaultAlt);

            if (!markdown) {
                throw new Error('Missing uploaded image URL.');
            }

            insertAtCursor(textarea, markdown, options.applyTextChange, insertionRange);
            showFlash(options.flash, 'success', uploadString(getString, source, 'Uploaded'));
            return upload;
        }).catch(function () {
            showFlash(options.flash, 'error', uploadString(getString, source, 'Failed'));
            return false;
        });
    }

    function handlePaste(event, textarea, options) {
        return handleImageFile(firstImageFile(event), event, textarea, options, 'paste');
    }

    function handleDragOver(event, textarea, options) {
        var config = options && options.config ? options.config : {};

        if (!hasImageFileTransfer(event && event.dataTransfer ? event.dataTransfer : null) || !canUpload(config)) {
            return false;
        }

        preventDefault(event);

        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = 'copy';
        }

        return true;
    }

    function handleDrop(event, textarea, options) {
        return handleImageFile(firstImageFile(event), event, textarea, options, 'drop');
    }

    function bind(textarea, options) {
        if (!textarea || textarea.easymdeImagePasteBound || typeof textarea.addEventListener !== 'function') {
            return;
        }

        textarea.easymdeImagePasteBound = true;
        textarea.addEventListener('paste', function (event) {
            handlePaste(event, textarea, options);
        });
        textarea.addEventListener('dragover', function (event) {
            handleDragOver(event, textarea, options);
        });
        textarea.addEventListener('drop', function (event) {
            handleDrop(event, textarea, options);
        });
    }

    window.EasyMDEImagePaste = {
        bind: bind,
        firstImageFile: firstImageFile,
        handleDragOver: handleDragOver,
        handleDrop: handleDrop,
        handlePaste: handlePaste,
        imageMarkdown: imageMarkdown
    };
})(window);
