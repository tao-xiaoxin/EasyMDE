(function (window) {
    'use strict';

    function storageAvailable() {
        try {
            var testKey = '__easymde_test__';
            window.localStorage.setItem(testKey, '1');
            window.localStorage.removeItem(testKey);
            return true;
        } catch (error) {
            return false;
        }
    }

    function normalizeStorage(config, postId) {
        var storage = config.storage || {};
        var resolvedPostId = postId || storage.postId || 'new';

        if (storage.siteKey && storage.userId !== undefined) {
            storage.postId = resolvedPostId;
            storage.draftKey = 'easymde:draft:' + storage.siteKey + ':' + storage.userId + ':' + resolvedPostId;
        }

        config.storage = storage;

        return storage;
    }

    function read(storage) {
        if (!storage.draftKey || !storageAvailable()) {
            return null;
        }

        try {
            return JSON.parse(window.localStorage.getItem(storage.draftKey) || 'null');
        } catch (error) {
            return null;
        }
    }

    function write(storage, markdown) {
        if (!storage.draftKey || !storageAvailable()) {
            return;
        }

        window.localStorage.setItem(
            storage.draftKey,
            JSON.stringify({
                content: markdown,
                updatedAt: Date.now()
            })
        );
    }

    function discard(storage) {
        if (!storage.draftKey || !storageAvailable()) {
            return;
        }

        window.localStorage.removeItem(storage.draftKey);
    }

    function formatTime(timestamp) {
        if (!timestamp) {
            return '';
        }

        try {
            return new Date(timestamp).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit'
            });
        } catch (error) {
            return '';
        }
    }

    window.EasyMDEDraftStorage = {
        normalizeStorage: normalizeStorage,
        read: read,
        write: write,
        discard: discard,
        formatTime: formatTime
    };
})(window);
