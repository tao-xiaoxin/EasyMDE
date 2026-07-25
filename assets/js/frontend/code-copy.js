(function (window, document) {
    'use strict';

    var SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
    var SUCCESS_DURATION = 1500;
    var clipboardWriteActive = false;
    var clipboardWriteQueue = [];
    var rootStates = new WeakMap();

    function noop() {}

    function getString(config, key) {
        var value = config && config.strings ? config.strings[key] : '';

        if ('string' !== typeof value || '' === value) {
            throw new Error('easymde-code-copy-missing-string:' + key);
        }

        return value;
    }

    function createSvg(className) {
        var svg = document.createElementNS(SVG_NAMESPACE, 'svg');

        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('focusable', 'false');
        svg.setAttribute('width', '14');
        svg.setAttribute('height', '14');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '2');
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('stroke-linejoin', 'round');
        svg.classList.add(className);

        return svg;
    }

    function createCopyIcon() {
        var svg = createSvg('lucide-copy');
        var rect = document.createElementNS(SVG_NAMESPACE, 'rect');
        var path = document.createElementNS(SVG_NAMESPACE, 'path');

        rect.setAttribute('width', '14');
        rect.setAttribute('height', '14');
        rect.setAttribute('x', '8');
        rect.setAttribute('y', '8');
        rect.setAttribute('rx', '2');
        rect.setAttribute('ry', '2');
        path.setAttribute('d', 'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2');
        svg.append(rect, path);

        return svg;
    }

    function createCheckIcon() {
        var svg = createSvg('lucide-check');
        var path = document.createElementNS(SVG_NAMESPACE, 'path');

        path.setAttribute('d', 'M20 6 9 17l-5-5');
        svg.append(path);

        return svg;
    }

    function replaceIcon(button, icon) {
        button.replaceChildren(icon);
    }

    function setReadyState(state, control) {
        if (control.timerId) {
            window.clearTimeout(control.timerId);
            control.timerId = 0;
        }

        control.timerGeneration += 1;
        control.button.classList.remove('is-copied');
        control.button.setAttribute('aria-label', control.strings.copyCode);
        control.button.setAttribute('title', control.strings.copyCode);
        replaceIcon(control.button, createCopyIcon());
        if (state.activeControl === control) {
            state.activeControl = null;
            announce(state, '');
        }
    }

    function prepareFeedbackState(state, control) {
        var generation;

        if (state.activeControl && state.activeControl !== control) {
            setReadyState(state, state.activeControl);
        }

        state.activeControl = control;
        if (control.timerId) {
            window.clearTimeout(control.timerId);
            control.timerId = 0;
        }

        control.timerGeneration += 1;
        generation = control.timerGeneration;
        return generation;
    }

    function scheduleReadyState(state, control, generation) {
        control.timerId = window.setTimeout(function () {
            if (state.destroyed || generation !== control.timerGeneration) {
                return;
            }

            control.timerId = 0;
            setReadyState(state, control);
        }, SUCCESS_DURATION);
    }

    function setCopiedState(state, control) {
        var generation = prepareFeedbackState(state, control);

        control.button.classList.add('is-copied');
        control.button.setAttribute('aria-label', control.strings.codeCopied);
        control.button.setAttribute('title', control.strings.copied);
        replaceIcon(control.button, createCheckIcon());
        announce(state, control.strings.codeCopied);
        scheduleReadyState(state, control, generation);
    }

    function setFailedState(state, control) {
        var generation = prepareFeedbackState(state, control);

        control.button.classList.remove('is-copied');
        control.button.setAttribute('aria-label', control.strings.codeCopyFailed);
        control.button.setAttribute('title', control.strings.codeCopyFailed);
        replaceIcon(control.button, createCopyIcon());
        announce(state, control.strings.codeCopyFailed);
        scheduleReadyState(state, control, generation);
    }

    function captureSelection(selection) {
        var ranges = [];
        var index;

        if (!selection) {
            return ranges;
        }

        for (index = 0; index < selection.rangeCount; index += 1) {
            ranges.push(selection.getRangeAt(index).cloneRange());
        }

        return ranges;
    }

    function restoreSelection(selection, ranges) {
        if (!selection) {
            return;
        }

        selection.removeAllRanges();
        ranges.forEach(function (range) {
            selection.addRange(range);
        });
    }

    function rememberSelection(state) {
        var selection = window.getSelection ? window.getSelection() : null;

        if (state.selectionFrozen) {
            return;
        }

        state.selectionRanges = captureSelection(selection);
    }

    function announce(state, message) {
        if (state.status) {
            state.status.textContent = message;
        }
    }

    function copyWithFallback(text, preservedRanges) {
        var activeElement = document.activeElement;
        var selection = window.getSelection ? window.getSelection() : null;
        var ranges = preservedRanges && preservedRanges.length
            ? preservedRanges.map(function (range) { return range.cloneRange(); })
            : captureSelection(selection);
        var scrollX = window.scrollX;
        var scrollY = window.scrollY;
        var textarea = document.createElement('textarea');
        var copied = false;

        textarea.className = 'easymde-code-copy__fallback';
        textarea.value = text;
        textarea.setAttribute('aria-hidden', 'true');
        textarea.setAttribute('readonly', '');
        document.body.append(textarea);

        try {
            textarea.select();
            textarea.setSelectionRange(0, textarea.value.length);
            copied = 'function' === typeof document.execCommand
                && true === document.execCommand('copy');
        } catch (error) {
            copied = false;
        } finally {
            textarea.remove();
            if (activeElement && 'function' === typeof activeElement.focus) {
                activeElement.focus({ preventScroll: true });
            }
            restoreSelection(selection, ranges);
            window.scrollTo(scrollX, scrollY);
        }

        return copied;
    }

    function copyText(text, preservedRanges, canUseFallback) {
        var clipboard = window.navigator && window.navigator.clipboard;
        var clipboardResult;

        if (clipboard && 'function' === typeof clipboard.writeText) {
            try {
                clipboardResult = clipboard.writeText(text);
            } catch (error) {
                return Promise.resolve(
                    canUseFallback() ? copyWithFallback(text, preservedRanges) : false
                );
            }

            return Promise.resolve(clipboardResult)
                .then(function () {
                    return true;
                }, function () {
                    return canUseFallback()
                        ? copyWithFallback(text, preservedRanges)
                        : false;
                });
        }

        return Promise.resolve(
            canUseFallback() ? copyWithFallback(text, preservedRanges) : false
        );
    }

    function drainClipboardWriteQueue() {
        var queued;

        if (clipboardWriteActive) {
            return;
        }

        queued = clipboardWriteQueue.shift();
        while (queued && !queued.canStart()) {
            queued.resolve(false);
            queued = clipboardWriteQueue.shift();
        }

        if (!queued) {
            return;
        }

        clipboardWriteActive = true;
        copyText(queued.text, queued.preservedRanges, queued.canStart).then(
            function (copied) {
                clipboardWriteActive = false;
                queued.resolve(copied);
                drainClipboardWriteQueue();
            },
            function (error) {
                clipboardWriteActive = false;
                queued.reject(error);
                drainClipboardWriteQueue();
            }
        );
    }

    function enqueueCopyText(text, preservedRanges, canStart) {
        return new Promise(function (resolve, reject) {
            clipboardWriteQueue.push({
                canStart: canStart,
                preservedRanges: preservedRanges,
                reject: reject,
                resolve: resolve,
                text: text
            });
            drainClipboardWriteQueue();
        });
    }

    function createControl(state, pre, code, strings) {
        var button = document.createElement('button');
        var control;

        button.type = 'button';
        button.className = 'easymde-code-copy__button';
        button.setAttribute('aria-label', strings.copyCode);
        button.setAttribute('title', strings.copyCode);
        button.append(createCopyIcon());
        pre.classList.add('easymde-code-copy');
        code.classList.add('easymde-code-copy__code');
        pre.append(button);

        control = {
            button: button,
            code: code,
            onClick: null,
            onMouseDown: null,
            pending: false,
            pre: pre,
            strings: strings,
            timerGeneration: 0,
            timerId: 0
        };

        control.onClick = function () {
            var operationGeneration;
            var preservedRanges;

            if (state.destroyed || control.pending) {
                return;
            }

            preservedRanges = state.selectionRanges.map(function (range) {
                return range.cloneRange();
            });
            state.operationGeneration += 1;
            operationGeneration = state.operationGeneration;
            if (state.pendingControl && state.pendingControl !== control) {
                state.pendingControl.pending = false;
                state.pendingControl.button.removeAttribute('aria-busy');
            }
            state.pendingControl = control;
            state.selectionFrozen = false;
            state.selectionOwner = null;
            control.pending = true;
            button.setAttribute('aria-busy', 'true');
            enqueueCopyText(code.textContent, preservedRanges, function () {
                return !state.destroyed
                    && operationGeneration === state.operationGeneration;
            }).then(function (copied) {
                if (
                    state.destroyed
                    || operationGeneration !== state.operationGeneration
                    || state.pendingControl !== control
                ) {
                    return;
                }

                state.pendingControl = null;
                control.pending = false;
                button.removeAttribute('aria-busy');
                if (copied) {
                    setCopiedState(state, control);
                } else {
                    setFailedState(state, control);
                    window.console.error('[EasyMDE code copy] clipboard-write-failed');
                }
            }, function () {
                if (
                    !state.destroyed
                    && operationGeneration === state.operationGeneration
                    && state.pendingControl === control
                ) {
                    state.pendingControl = null;
                    control.pending = false;
                    button.removeAttribute('aria-busy');
                    setFailedState(state, control);
                    window.console.error('[EasyMDE code copy] clipboard-write-failed');
                }
            });
        };

        control.onMouseDown = function () {
            state.selectionRanges = captureSelection(
                window.getSelection ? window.getSelection() : null
            );
            state.selectionFrozen = true;
            state.selectionOwner = button;
        };

        button.addEventListener('mousedown', control.onMouseDown);
        button.addEventListener('click', control.onClick);
        return control;
    }

    function findRoots(root) {
        var roots = [];

        if (root.classList && root.classList.contains('easymde-rendered-content')) {
            roots.push(root);
        }

        if (root.querySelectorAll) {
            root.querySelectorAll('.easymde-rendered-content').forEach(function (renderedRoot) {
                if (-1 === roots.indexOf(renderedRoot)) {
                    roots.push(renderedRoot);
                }
            });
        }

        return roots;
    }

    function isMermaidCode(code) {
        return Array.prototype.some.call(code.classList, function (className) {
            return 'language-mermaid' === className.toLowerCase();
        });
    }

    function enhanceRoot(root, config) {
        var existing = rootStates.get(root);
        var strings;
        var state;

        if (existing) {
            return existing.cleanup;
        }

        strings = {
            copyCode: getString(config, 'copyCode'),
            copied: getString(config, 'copied'),
            codeCopied: getString(config, 'codeCopied'),
            codeCopyFailed: getString(config, 'codeCopyFailed')
        };
        state = {
            activeControl: null,
            cleanup: null,
            controls: [],
            destroyed: false,
            operationGeneration: 0,
            pendingControl: null,
            root: root,
            selectionFrozen: false,
            selectionRanges: captureSelection(window.getSelection ? window.getSelection() : null),
            selectionListener: null,
            selectionMouseUpListener: null,
            selectionOwner: null,
            status: null
        };

        state.selectionListener = function () {
            rememberSelection(state);
        };
        state.selectionMouseUpListener = function (event) {
            if (state.selectionOwner && event.target !== state.selectionOwner) {
                state.selectionFrozen = false;
                state.selectionOwner = null;
                rememberSelection(state);
            }
        };

        root.querySelectorAll('pre > code').forEach(function (code) {
            if (isMermaidCode(code)) {
                return;
            }

            state.controls.push(createControl(state, code.parentElement, code, strings));
        });

        if (0 === state.controls.length) {
            return noop;
        }

        state.status = document.createElement('span');
        state.status.className = 'easymde-code-copy__status';
        state.status.setAttribute('aria-atomic', 'true');
        state.status.setAttribute('aria-live', 'polite');
        state.status.setAttribute('role', 'status');
        root.append(state.status);

        document.addEventListener('selectionchange', state.selectionListener);
        document.addEventListener('mouseup', state.selectionMouseUpListener);
        root.classList.add('easymde-code-copy-enabled');
        state.cleanup = function () {
            if (state.destroyed) {
                return;
            }

            state.destroyed = true;
            state.operationGeneration += 1;
            state.pendingControl = null;
            state.controls.forEach(function (control) {
                if (control.timerId) {
                    window.clearTimeout(control.timerId);
                    control.timerId = 0;
                }
                control.pending = false;
                control.timerGeneration += 1;
                control.button.removeEventListener('mousedown', control.onMouseDown);
                control.button.removeEventListener('click', control.onClick);
                control.button.remove();
                control.pre.classList.remove('easymde-code-copy');
                control.code.classList.remove('easymde-code-copy__code');
            });
            document.removeEventListener('selectionchange', state.selectionListener);
            document.removeEventListener('mouseup', state.selectionMouseUpListener);
            state.status.remove();
            root.classList.remove('easymde-code-copy-enabled');
            rootStates.delete(root);
        };

        rootStates.set(root, state);
        return state.cleanup;
    }

    function enhance(root, config) {
        var cleanups = [];

        if (!root || !config || !config.features || true !== config.features.codeCopy) {
            return noop;
        }

        findRoots(root).forEach(function (renderedRoot) {
            cleanups.push(enhanceRoot(renderedRoot, config));
        });

        return function () {
            cleanups.forEach(function (cleanup) {
                cleanup();
            });
        };
    }

    window.EasyMDECodeCopy = {
        enhance: enhance
    };
})(window, document);
