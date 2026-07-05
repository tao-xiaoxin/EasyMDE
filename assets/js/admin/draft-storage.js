(function (window) {
    'use strict';

    var storageAvailableCache = null;
    var utf8Encoder = null;

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

    function updateFnv1a(hash, byteValue) {
        hash ^= byteValue;

        return (hash + (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)) >>> 0;
    }

    function getUtf8Encoder() {
        if (utf8Encoder !== null) {
            return utf8Encoder || null;
        }

        if (!window.TextEncoder) {
            utf8Encoder = false;
            return null;
        }

        try {
            utf8Encoder = new window.TextEncoder();
        } catch (error) {
            utf8Encoder = false;
        }

        return utf8Encoder || null;
    }

    function formatFingerprint(byteLength, hash) {
        return byteLength + ':' + ('0000000' + hash.toString(16)).slice(-8);
    }

    function draftHashKey(storage) {
        return storage.draftKey ? storage.draftKey + ':hash' : '';
    }

    function contentFingerprintFromBytes(bytes) {
        var hash = 0x811c9dc5;
        var index;

        for (index = 0; index < bytes.length; index += 1) {
            hash = updateFnv1a(hash, bytes[index]);
        }

        return formatFingerprint(bytes.length, hash);
    }

    function updateUtf8CodePoint(hash, codePoint, byteLength) {
        if (codePoint < 0x80) {
            return {
                hash: updateFnv1a(hash, codePoint),
                byteLength: byteLength + 1
            };
        }

        if (codePoint < 0x800) {
            hash = updateFnv1a(hash, 0xc0 | (codePoint >> 6));
            hash = updateFnv1a(hash, 0x80 | (codePoint & 0x3f));

            return {
                hash: hash,
                byteLength: byteLength + 2
            };
        }

        if (codePoint < 0x10000) {
            hash = updateFnv1a(hash, 0xe0 | (codePoint >> 12));
            hash = updateFnv1a(hash, 0x80 | ((codePoint >> 6) & 0x3f));
            hash = updateFnv1a(hash, 0x80 | (codePoint & 0x3f));

            return {
                hash: hash,
                byteLength: byteLength + 3
            };
        }

        hash = updateFnv1a(hash, 0xf0 | (codePoint >> 18));
        hash = updateFnv1a(hash, 0x80 | ((codePoint >> 12) & 0x3f));
        hash = updateFnv1a(hash, 0x80 | ((codePoint >> 6) & 0x3f));
        hash = updateFnv1a(hash, 0x80 | (codePoint & 0x3f));

        return {
            hash: hash,
            byteLength: byteLength + 4
        };
    }

    function contentFingerprint(markdown) {
        var content = markdown === null || markdown === undefined ? '' : String(markdown);
        var encoder = getUtf8Encoder();
        var hash = 0x811c9dc5;
        var byteLength = 0;
        var index;
        var codePoint;
        var next;
        var updated;

        if (encoder) {
            return contentFingerprintFromBytes(encoder.encode(content));
        }

        for (index = 0; index < content.length; index += 1) {
            codePoint = content.charCodeAt(index);

            if (codePoint >= 0xd800 && codePoint <= 0xdbff && index + 1 < content.length) {
                next = content.charCodeAt(index + 1);
                if (next >= 0xdc00 && next <= 0xdfff) {
                    codePoint = 0x10000 + ((codePoint - 0xd800) * 0x400) + (next - 0xdc00);
                    index += 1;
                }
            }

            if (codePoint >= 0xd800 && codePoint <= 0xdfff) {
                codePoint = 0xfffd;
            }

            updated = updateUtf8CodePoint(hash, codePoint, byteLength);
            hash = updated.hash;
            byteLength = updated.byteLength;
        }

        return formatFingerprint(byteLength, hash);
    }

    function read(storage) {
        var localStorage;

        if (!storage.draftKey) {
            return null;
        }

        try {
            localStorage = getLocalStorage();
            return localStorage ? JSON.parse(localStorage.getItem(storage.draftKey) || 'null') : null;
        } catch (error) {
            return null;
        }
    }

    function readContentHash(storage) {
        var localStorage;
        var hashKey = draftHashKey(storage);

        if (!hashKey) {
            return '';
        }

        try {
            localStorage = getLocalStorage();
            return localStorage ? String(localStorage.getItem(hashKey) || '') : '';
        } catch (error) {
            return '';
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
        var contentHash;
        var hashKey = draftHashKey(storage);

        if (!storage.draftKey || !storageAvailable()) {
            return;
        }

        try {
            localStorage = getLocalStorage();
            if (localStorage) {
                contentHash = contentFingerprint(markdown);
                if (hashKey) {
                    localStorage.removeItem(hashKey);
                }
                localStorage.setItem(
                    storage.draftKey,
                    JSON.stringify({
                        content: markdown,
                        contentHash: contentHash,
                        updatedAt: Date.now()
                    })
                );
                if (hashKey) {
                    localStorage.setItem(hashKey, contentHash);
                }
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
                localStorage.removeItem(draftHashKey(storage));
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
        readContentHash: readContentHash,
        exists: exists,
        write: write,
        discard: discard,
        formatTime: formatTime,
        contentFingerprint: contentFingerprint
    };
})(window);
