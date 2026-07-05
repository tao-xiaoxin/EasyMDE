(function (window) {
    'use strict';

    var storageAvailableCache = null;

    function getLocalStorage() {
        try {
            return window.localStorage || null;
        } catch (error) {
            return null;
        }
    }

    function storageAvailable() {
        var localStorage;

        if (storageAvailableCache !== null) {
            return storageAvailableCache;
        }

        try {
            var testKey = '__easymde_test__';
            localStorage = getLocalStorage();
            if (!localStorage) {
                storageAvailableCache = false;
                return storageAvailableCache;
            }
            localStorage.setItem(testKey, '1');
            localStorage.removeItem(testKey);
            storageAvailableCache = true;
            return storageAvailableCache;
        } catch (error) {
            storageAvailableCache = false;
            return storageAvailableCache;
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
        var localStorage;

        if (!storage.draftKey || !storageAvailable()) {
            return null;
        }

        try {
            localStorage = getLocalStorage();
            return localStorage ? JSON.parse(localStorage.getItem(storage.draftKey) || 'null') : null;
        } catch (error) {
            return null;
        }
    }

    function exists(storage) {
        var localStorage = getLocalStorage();

        try {
            return !!(
                storage.draftKey
                && localStorage
                && typeof localStorage.getItem === 'function'
                && localStorage.getItem(storage.draftKey) !== null
            );
        } catch (error) {
            return false;
        }
    }

    function write(storage, markdown) {
        var localStorage;

        if (!storage.draftKey || !storageAvailable()) {
            return;
        }

        try {
            localStorage = getLocalStorage();
            if (localStorage) {
                localStorage.setItem(
                    storage.draftKey,
                    JSON.stringify({
                        content: markdown,
                        updatedAt: Date.now()
                    })
                );
            }
        } catch (error) {
            return;
        }
    }

    function discard(storage) {
        var localStorage;

        if (!storage.draftKey || !storageAvailable()) {
            return;
        }

        try {
            localStorage = getLocalStorage();
            if (localStorage) {
                localStorage.removeItem(storage.draftKey);
            }
        } catch (error) {
            return;
        }
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
        exists: exists,
        write: write,
        discard: discard,
        formatTime: formatTime
    };
})(window);
