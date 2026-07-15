(function (window) {
    'use strict';

    var HISTORY_LIMIT = 100;

    function createHistory(initialValue, limit) {
        var entries = [String(initialValue || '')];
        var index = 0;
        var maximum = Math.max(2, Number(limit) || HISTORY_LIMIT);

        function current() {
            return entries[index];
        }

        return {
            current: current,
            canUndo: function () { return index > 0; },
            canRedo: function () { return index < entries.length - 1; },
            push: function (value) {
                var normalized = String(value || '');
                if (normalized === current()) {
                    return false;
                }
                entries = entries.slice(0, index + 1);
                entries.push(normalized);
                if (entries.length > maximum) {
                    entries.splice(0, entries.length - maximum);
                }
                index = entries.length - 1;
                return true;
            },
            reset: function (value) {
                entries = [String(value || '')];
                index = 0;
            },
            undo: function () {
                if (index <= 0) {
                    return null;
                }
                index -= 1;
                return entries[index];
            },
            redo: function () {
                if (index >= entries.length - 1) {
                    return null;
                }
                index += 1;
                return entries[index];
            }
        };
    }

    function normalizePastedText(value) {
        if (typeof value !== 'string') {
            throw new Error('Visual editor paste requires plain text.');
        }
        return value
            .replace(/\r\n?/g, '\n')
            .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
    }

    function isMutationKey(event) {
        var key = String(event && event.key || '');
        var modified = !!(event && (event.ctrlKey || event.metaKey));

        if (modified) {
            return ['v', 'x', 'z', 'y'].indexOf(key.toLowerCase()) !== -1;
        }
        if (event && event.altKey) {
            return false;
        }
        if (['Enter', 'Backspace', 'Delete', 'Tab'].indexOf(key) !== -1) {
            return true;
        }
        return key.length === 1;
    }

    function inlineTokensFromDom(root, model) {
        if (!root || !model || typeof model.isSafeUrl !== 'function') {
            throw new Error('Visual editor DOM conversion dependencies are unavailable.');
        }

        function children(node) {
            var output = [];
            Array.prototype.forEach.call(node.childNodes || [], function (child) {
                output = output.concat(convert(child));
            });
            return output;
        }

        function convert(node) {
            var tag;
            var href;
            var title;
            var nested;

            if (node.nodeType === 3) {
                return [{ type: 'text', value: String(node.nodeValue || ''), literal: true }];
            }
            if (node.nodeType !== 1) {
                throw new Error('Unsupported visual editor DOM node.');
            }
            tag = String(node.tagName || '').toUpperCase();
            if (tag === 'SPAN') {
                return children(node);
            }
            if (tag === 'BR') {
                return [{ type: 'text', value: '\n', literal: true }];
            }
            if (tag === 'STRONG' || tag === 'B') {
                return [{ type: 'strong', children: children(node) }];
            }
            if (tag === 'EM' || tag === 'I') {
                return [{ type: 'emphasis', children: children(node) }];
            }
            if (tag === 'DEL' || tag === 'S') {
                return [{ type: 'strike', children: children(node) }];
            }
            if (tag === 'CODE') {
                nested = children(node);
                if (nested.some(function (token) { return token.type !== 'text'; })) {
                    throw new Error('Unsupported formatted content inside inline code.');
                }
                return [{
                    type: 'code',
                    value: nested.map(function (token) { return token.value; }).join('')
                }];
            }
            if (tag === 'A') {
                href = String(node.getAttribute('href') || '').trim();
                title = String(node.getAttribute('title') || '');
                if (!model.isSafeUrl(href)) {
                    throw new Error('Unsafe visual editor link URL.');
                }
                return [{ type: 'link', href: href, title: title, children: children(node) }];
            }
            throw new Error('Unsupported visual editor DOM element: ' + tag.toLowerCase());
        }

        return children(root);
    }

    function protectedLabel(type) {
        var labels = {
            image: 'Image',
            inlineMath: 'Inline math',
            math: 'Math',
            mermaid: 'Mermaid',
            table: 'Table',
            toc: 'Table of contents',
            unknown: 'Extension'
        };
        return labels[type] || labels.unknown;
    }

    function setEditable(element, readOnly) {
        element.setAttribute('contenteditable', readOnly ? 'false' : 'plaintext-only');
        element.setAttribute('aria-readonly', readOnly ? 'true' : 'false');
        element.spellcheck = !readOnly;
    }

    function renderInline(documentRef, tokens) {
        var fragment = documentRef.createDocumentFragment();

        (tokens || []).forEach(function (token) {
            var element;
            var tagNames = {
                strong: 'strong',
                emphasis: 'em',
                strike: 'del'
            };

            if (token.type === 'text') {
                fragment.appendChild(documentRef.createTextNode(String(token.value || '')));
                return;
            }
            if (token.type === 'code') {
                element = documentRef.createElement('code');
                element.textContent = String(token.value || '');
                fragment.appendChild(element);
                return;
            }
            if (token.type === 'link') {
                element = documentRef.createElement('a');
                element.setAttribute('href', String(token.href || ''));
                if (token.title) {
                    element.setAttribute('title', String(token.title));
                }
                element.appendChild(renderInline(documentRef, token.children));
                fragment.appendChild(element);
                return;
            }
            if (tagNames[token.type]) {
                element = documentRef.createElement(tagNames[token.type]);
                element.appendChild(renderInline(documentRef, token.children));
                fragment.appendChild(element);
                return;
            }
            throw new Error('Unsupported visual editor render token: ' + token.type);
        });

        return fragment;
    }

    function createInlineContent(documentRef, node, tokens, readOnly) {
        var content = documentRef.createElement('span');
        content.className = 'easymde-visual-editor__inline-content';
        content.setAttribute('data-easymde-inline-content', '1');
        setEditable(content, readOnly);
        content.appendChild(renderInline(documentRef, tokens));
        return content;
    }

    function renderList(documentRef, node, readOnly) {
        var wrapper = documentRef.createElement('div');
        var stack = [];

        wrapper.className = 'easymde-visual-editor__list';
        node.items.forEach(function (item, index) {
            var depth = Math.max(0, Number(item.depth) || 0);
            var tagName = item.ordered ? 'ol' : 'ul';
            var list;
            var entry;
            var checkbox;

            while (stack.length > depth + 1) {
                stack.pop();
            }
            if (!stack[depth] || stack[depth].tagName !== tagName) {
                list = documentRef.createElement(tagName);
                if (depth === 0) {
                    wrapper.appendChild(list);
                } else if (stack[depth - 1] && stack[depth - 1].lastEntry) {
                    stack[depth - 1].lastEntry.appendChild(list);
                } else {
                    wrapper.appendChild(list);
                }
                stack[depth] = { list: list, tagName: tagName, lastEntry: null };
                stack.length = depth + 1;
            }
            entry = documentRef.createElement('li');
            entry.setAttribute('data-easymde-list-item', String(index));
            if (item.task) {
                checkbox = documentRef.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.checked = !!item.checked;
                checkbox.disabled = readOnly;
                checkbox.setAttribute('data-easymde-task-toggle', String(index));
                checkbox.setAttribute('aria-label', item.checked ? 'Mark task incomplete' : 'Mark task complete');
                entry.appendChild(checkbox);
            }
            entry.appendChild(createInlineContent(documentRef, node, item.inline, readOnly));
            stack[depth].list.appendChild(entry);
            stack[depth].lastEntry = entry;
        });
        return wrapper;
    }

    function renderNode(documentRef, node, readOnly, strings) {
        var element;
        var language;
        var pre;
        var code;
        var label;
        var excerpt;
        var button;

        if (node.type === 'gap') {
            element = documentRef.createElement('div');
            element.className = 'easymde-visual-editor__gap';
            element.setAttribute('aria-hidden', 'true');
            return element;
        }
        if (node.type === 'protected') {
            element = documentRef.createElement('section');
            element.className = 'easymde-visual-editor__protected';
            element.setAttribute('data-easymde-node-id', node.id);
            element.setAttribute('data-easymde-node-type', node.type);
            element.setAttribute('data-easymde-protected-type', node.protectedType);
            element.setAttribute('tabindex', '0');
            element.setAttribute('aria-label', protectedLabel(node.protectedType) + ' protected Markdown block');
            label = documentRef.createElement('strong');
            label.textContent = protectedLabel(node.protectedType);
            excerpt = documentRef.createElement('pre');
            excerpt.textContent = stripProtectedExcerpt(node.raw);
            button = documentRef.createElement('button');
            button.type = 'button';
            button.setAttribute('data-easymde-edit-source', node.id);
            button.textContent = strings.editInMarkdown || 'Edit in Markdown';
            element.appendChild(label);
            element.appendChild(excerpt);
            element.appendChild(button);
            return element;
        }
        if (node.type === 'heading') {
            element = documentRef.createElement('h' + String(node.level));
            element.appendChild(createInlineContent(documentRef, node, node.inline, readOnly));
        } else if (node.type === 'paragraph') {
            element = documentRef.createElement('p');
            element.appendChild(createInlineContent(documentRef, node, node.inline, readOnly));
            if (node.synthetic) {
                element.firstChild.setAttribute('data-placeholder', strings.emptyPlaceholder || 'Start writing Markdown...');
            }
        } else if (node.type === 'horizontalRule') {
            element = documentRef.createElement('hr');
            element.setAttribute('tabindex', readOnly ? '-1' : '0');
        } else if (node.type === 'blockquote') {
            element = documentRef.createElement('blockquote');
            node.lines.forEach(function (line, index) {
                var paragraph = documentRef.createElement('p');
                paragraph.setAttribute('data-easymde-quote-line', String(index));
                if (!line.blank || !readOnly) {
                    paragraph.appendChild(createInlineContent(documentRef, node, line.inline, readOnly));
                }
                element.appendChild(paragraph);
            });
        } else if (node.type === 'list') {
            element = renderList(documentRef, node, readOnly);
        } else if (node.type === 'code') {
            element = documentRef.createElement('figure');
            element.className = 'easymde-visual-editor__code';
            language = documentRef.createElement('input');
            language.type = 'text';
            language.value = node.language;
            language.disabled = readOnly;
            language.setAttribute('data-easymde-code-language', '1');
            language.setAttribute('aria-label', strings.codeLanguage || 'Code language');
            pre = documentRef.createElement('pre');
            code = documentRef.createElement('code');
            code.textContent = node.content;
            code.setAttribute('data-easymde-code-content', '1');
            setEditable(code, readOnly);
            pre.appendChild(code);
            element.appendChild(language);
            element.appendChild(pre);
        } else {
            throw new Error('Unsupported visual editor block: ' + node.type);
        }
        element.setAttribute('data-easymde-node-id', node.id);
        element.setAttribute('data-easymde-node-type', node.type);
        return element;
    }

    function stripProtectedExcerpt(raw) {
        var value = String(raw || '').trim();
        return value.length > 240 ? value.slice(0, 237) + '...' : value;
    }

    function createAdapter(options) {
        options = options || {};
        var model = options.model || window.EasyMDEVisualMarkdownModel;
        var documentRef = options.document || window.document || null;
        var windowRef = options.window || window;
        var markdown = '';
        var initialMarkdown = null;
        var modelDocument = null;
        var history = createHistory('');
        var readOnly = true;
        var mounted = false;
        var composing = false;
        var host = null;
        var root = null;
        var mountOptions = {};
        var selection = null;
        var pendingElements = [];
        var pendingTimer = null;
        var navigationTimer = null;
        var navigationElement = null;
        var listeners = [];
        var changeCallbacks = [];
        var errorCallbacks = [];

        function requireModel() {
            if (
                !model
                || typeof model.parse !== 'function'
                || typeof model.serialize !== 'function'
                || typeof model.updateNode !== 'function'
            ) {
                throw new Error('The visual Markdown model is unavailable.');
            }
        }

        function reportError(error) {
            errorCallbacks.slice().forEach(function (callback) {
                callback(error);
            });
        }

        function emitChange(value, metadata) {
            changeCallbacks.slice().forEach(function (callback) {
                callback(value, metadata || {});
            });
        }

        function listen(target, type, callback, capture) {
            target.addEventListener(type, callback, !!capture);
            listeners.push(function () {
                target.removeEventListener(type, callback, !!capture);
            });
        }

        function closestElement(node, selector) {
            var element = node && node.nodeType === 1 ? node : node && node.parentElement;
            return element && typeof element.closest === 'function' ? element.closest(selector) : null;
        }

        function sourceLines(value) {
            var lines = String(value || '').match(/[^\r\n]*(?:\r\n|\r|\n|$)/g) || [];
            if (lines.length && lines[lines.length - 1] === '') {
                lines.pop();
            }
            return lines;
        }

        function contentPart(content) {
            var item = closestElement(content, '[data-easymde-list-item]');
            var quoteLine = closestElement(content, '[data-easymde-quote-line]');
            if (item) {
                return { type: 'list', index: Number(item.getAttribute('data-easymde-list-item')) };
            }
            if (quoteLine) {
                return { type: 'blockquote', index: Number(quoteLine.getAttribute('data-easymde-quote-line')) };
            }
            return { type: 'node', index: 0 };
        }

        function sourceSegment(node, content) {
            var part = contentPart(content);
            var lines;
            var relativeStart;
            if (part.type === 'node') {
                return { start: node.start, end: node.end, raw: node.raw, part: part };
            }
            if (node.type !== part.type || !Number.isInteger(part.index) || part.index < 0) {
                throw new Error('The active visual Markdown sub-block is invalid.');
            }
            lines = sourceLines(node.raw);
            if (!lines[part.index]) {
                throw new Error('The active visual Markdown source slice is unavailable.');
            }
            relativeStart = lines.slice(0, part.index).join('').length;
            return {
                start: node.start + relativeStart,
                end: node.start + relativeStart + lines[part.index].length,
                raw: lines[part.index],
                part: part
            };
        }

        function findModelNode(nodeId) {
            return modelDocument && modelDocument.nodes.find(function (node) {
                return node.id === nodeId;
            });
        }

        function render() {
            if (!root) {
                return;
            }
            root.textContent = '';
            modelDocument.nodes.forEach(function (node) {
                root.appendChild(renderNode(documentRef, node, readOnly, mountOptions.strings || {}));
            });
            applyReadOnlyState();
        }

        function applyReadOnlyState() {
            if (!root) {
                return;
            }
            root.setAttribute('aria-readonly', readOnly ? 'true' : 'false');
            root.classList.toggle('is-read-only', readOnly);
            root.querySelectorAll('[data-easymde-inline-content], [data-easymde-code-content]').forEach(function (element) {
                setEditable(element, readOnly);
            });
            root.querySelectorAll('[data-easymde-code-language], [data-easymde-task-toggle]').forEach(function (control) {
                control.disabled = readOnly;
            });
        }

        function setMarkdown(value) {
            var normalized = String(value || '');
            requireModel();
            if (mounted && !composing) {
                flush();
            }
            modelDocument = model.parse(normalized);
            markdown = normalized;
            if (initialMarkdown === null) {
                initialMarkdown = normalized;
                history.reset(normalized);
            } else if (mounted) {
                history.push(normalized);
            }
            if (mounted) {
                render();
            }
            return true;
        }

        function commitModel(nextDocument, metadata, bookmark) {
            var nextMarkdown = model.serialize(nextDocument);
            modelDocument = nextDocument;
            if (nextMarkdown === markdown) {
                return false;
            }
            markdown = nextMarkdown;
            history.push(markdown);
            emitChange(markdown, metadata || {});
            selection = bookmark || selection;
            return true;
        }

        function captureList(nodeElement, node) {
            var items = node.items.map(function (item, index) {
                var entry = nodeElement.querySelector('[data-easymde-list-item="' + String(index) + '"]');
                var content = entry && entry.querySelector('[data-easymde-inline-content]');
                var checkbox = entry && entry.querySelector('[data-easymde-task-toggle]');
                if (!entry || !content) {
                    throw new Error('Visual list structure is incomplete.');
                }
                return Object.assign({}, item, {
                    checked: item.task ? !!(checkbox && checkbox.checked) : false,
                    inline: inlineTokensFromDom(content, model)
                });
            });
            return model.updateNode(modelDocument, node.id, { items: items });
        }

        function captureBlockquote(nodeElement, node) {
            var lines = [];
            nodeElement.querySelectorAll('[data-easymde-quote-line]').forEach(function (lineElement) {
                var content = lineElement.querySelector('[data-easymde-inline-content]');
                var inline = content ? inlineTokensFromDom(content, model) : [];
                lines.push({ inline: inline, blank: inline.length === 0 });
            });
            return model.updateNode(modelDocument, node.id, { lines: lines });
        }

        function captureNode(nodeElement) {
            var nodeId = nodeElement && nodeElement.getAttribute('data-easymde-node-id');
            var node = findModelNode(nodeId);
            var content;
            var nextDocument;
            var bookmark = captureSelection();

            if (!node || !node.editable) {
                throw new Error('Editable visual Markdown node not found.');
            }
            if (node.type === 'paragraph' || node.type === 'heading') {
                content = nodeElement.querySelector('[data-easymde-inline-content]');
                nextDocument = model.updateNode(modelDocument, node.id, {
                    inline: inlineTokensFromDom(content, model)
                });
            } else if (node.type === 'list') {
                nextDocument = captureList(nodeElement, node);
            } else if (node.type === 'blockquote') {
                nextDocument = captureBlockquote(nodeElement, node);
            } else if (node.type === 'code') {
                nextDocument = model.updateNode(modelDocument, node.id, {
                    content: String(nodeElement.querySelector('[data-easymde-code-content]').textContent || ''),
                    language: String(nodeElement.querySelector('[data-easymde-code-language]').value || '').trim()
                });
            } else {
                throw new Error('Visual node does not accept direct text input: ' + node.type);
            }
            return commitModel(nextDocument, { input: true, nodeId: node.id }, bookmark);
        }

        function cancelPendingCapture() {
            if (pendingTimer !== null) {
                windowRef.clearTimeout(pendingTimer);
                pendingTimer = null;
            }
            pendingElements = [];
        }

        function flush() {
            var nodeElements;
            if (composing || !pendingElements.length) {
                return markdown;
            }
            nodeElements = pendingElements.slice();
            cancelPendingCapture();
            try {
                nodeElements.forEach(captureNode);
            } catch (error) {
                reportError(error);
                render();
            }
            return markdown;
        }

        function scheduleCapture(target) {
            var nodeElement = closestElement(target, '[data-easymde-node-id]');
            var nodeId;
            var pendingIndex;
            if (!nodeElement || readOnly) {
                return;
            }
            nodeId = nodeElement.getAttribute('data-easymde-node-id');
            pendingIndex = pendingElements.findIndex(function (element) {
                return element.getAttribute('data-easymde-node-id') === nodeId;
            });
            if (pendingIndex === -1) {
                pendingElements.push(nodeElement);
            } else {
                pendingElements[pendingIndex] = nodeElement;
            }
            if (pendingTimer !== null) {
                windowRef.clearTimeout(pendingTimer);
            }
            pendingTimer = windowRef.setTimeout(function () {
                pendingTimer = null;
                if (!composing && pendingElements.length) {
                    flush();
                }
            }, 120);
        }

        function textOffset(content, node, offset) {
            var range = documentRef.createRange();
            range.selectNodeContents(content);
            range.setEnd(node, offset);
            return range.toString().length;
        }

        function captureSelection() {
            var nativeSelection;
            var range;
            var content;
            var nodeElement;
            var nodeId;
            var part;
            if (!root || !windowRef.getSelection) {
                return selection;
            }
            nativeSelection = windowRef.getSelection();
            if (!nativeSelection || nativeSelection.rangeCount < 1) {
                return selection;
            }
            range = nativeSelection.getRangeAt(0);
            content = closestElement(range.startContainer, '[data-easymde-inline-content], [data-easymde-code-content]');
            if (!content || !root.contains(content) || !content.contains(range.endContainer)) {
                return selection;
            }
            nodeElement = closestElement(content, '[data-easymde-node-id]');
            if (!nodeElement) {
                return selection;
            }
            nodeId = nodeElement.getAttribute('data-easymde-node-id');
            selection = {
                nodeId: nodeId,
                start: textOffset(content, range.startContainer, range.startOffset),
                end: textOffset(content, range.endContainer, range.endOffset)
            };
            part = contentPart(content);
            if (part.type !== 'node') {
                selection.partType = part.type;
                selection.partIndex = part.index;
            }
            return Object.assign({}, selection);
        }

        function sourceBoundaryForSelection(bookmark) {
            var currentDocument = bookmark ? model.parse(markdown) : null;
            var node = currentDocument && currentDocument.nodes.find(function (candidate) {
                return candidate.id === bookmark.nodeId;
            });
            var offset;

            if (!node) {
                return null;
            }
            offset = Math.max(0, Math.min(Number(node.end) || 0, markdown.length));
            return {
                nodeId: node.id,
                start: offset,
                end: offset
            };
        }

        function transferredFiles(event) {
            var transfer = event && (event.clipboardData || event.dataTransfer);

            return transfer && transfer.files && transfer.files.length ? transfer.files : null;
        }

        function handleFileTransfer(event, source) {
            var files = transferredFiles(event);
            var bookmark;
            var target;

            if (!files) {
                return false;
            }
            if (typeof mountOptions.onFileTransfer !== 'function') {
                reportError(new Error('Visual editor file transfer is unavailable.'));
                return true;
            }
            bookmark = captureSelection();
            flush();
            target = sourceBoundaryForSelection(bookmark);
            if (!target) {
                reportError(new Error('Visual editor file insertion target is unavailable.'));
                return true;
            }
            mountOptions.onFileTransfer(files, source, target);
            return true;
        }

        function textNodes(rootNode) {
            var output = [];
            function visit(node) {
                if (node.nodeType === 3) {
                    output.push(node);
                    return;
                }
                Array.prototype.forEach.call(node.childNodes || [], visit);
            }
            visit(rootNode);
            return output;
        }

        function pointAtOffset(content, offset) {
            var nodes = textNodes(content);
            var remaining = Math.max(0, Number(offset) || 0);
            var point = null;
            nodes.some(function (node) {
                var length = String(node.nodeValue || '').length;
                if (remaining <= length) {
                    point = { node: node, offset: remaining };
                    return true;
                }
                remaining -= length;
                return false;
            });
            if (!point) {
                if (!nodes.length) {
                    content.appendChild(documentRef.createTextNode(''));
                    nodes = textNodes(content);
                }
                point = { node: nodes[nodes.length - 1], offset: String(nodes[nodes.length - 1].nodeValue || '').length };
            }
            return point;
        }

        function inlineTokensForRange(content, start, end) {
            var range = documentRef.createRange();
            var startPoint = pointAtOffset(content, start);
            var endPoint = pointAtOffset(content, end);
            range.setStart(startPoint.node, startPoint.offset);
            range.setEnd(endPoint.node, endPoint.offset);
            return inlineTokensFromDom(range.cloneContents(), model);
        }

        function bookmarkAtSourceOffset(offset, start, end) {
            var node = modelDocument.nodes.find(function (candidate) {
                return candidate.editable && candidate.start === offset;
            }) || modelDocument.nodes.find(function (candidate) {
                return candidate.editable
                    && candidate.start <= offset
                    && (offset < candidate.end || (candidate.start === candidate.end && offset === candidate.start));
            });
            var bookmark;
            var lines;
            var relative;
            var consumed = 0;
            var partIndex = 0;
            if (!node) {
                throw new Error('The visual Markdown replacement target is unavailable.');
            }
            bookmark = {
                nodeId: node.id,
                start: Math.max(0, Number(start) || 0),
                end: Math.max(0, Number(end) || 0)
            };
            if (node.type === 'list' || node.type === 'blockquote') {
                lines = sourceLines(node.raw);
                relative = Math.max(0, offset - node.start);
                lines.some(function (line, index) {
                    if (relative < consumed + line.length || index === lines.length - 1) {
                        partIndex = index;
                        return true;
                    }
                    consumed += line.length;
                    return false;
                });
                bookmark.partType = node.type;
                bookmark.partIndex = partIndex;
            }
            return bookmark;
        }

        function replaceSourceRange(segment, replacement, metadata, targetOffset, start, end) {
            var nextMarkdown;
            var bookmark;
            if (
                !segment
                || !Number.isInteger(segment.start)
                || !Number.isInteger(segment.end)
                || segment.start < 0
                || segment.end < segment.start
                || segment.end > markdown.length
            ) {
                throw new Error('The visual Markdown replacement range is invalid.');
            }
            cancelPendingCapture();
            nextMarkdown = markdown.slice(0, segment.start) + replacement + markdown.slice(segment.end);
            modelDocument = model.parse(nextMarkdown);
            markdown = model.serialize(modelDocument);
            history.push(markdown);
            emitChange(markdown, metadata || {});
            bookmark = bookmarkAtSourceOffset(targetOffset, start, end);
            selection = Object.assign({}, bookmark);
            render();
            restoreSelection(bookmark);
            return true;
        }

        function restoreSelection(value) {
            var bookmark = value || selection;
            var nodeElement;
            var content;
            var start;
            var end;
            var range;
            var nativeSelection;
            if (!root || !bookmark || !windowRef.getSelection) {
                return false;
            }
            nodeElement = root.querySelector('[data-easymde-node-id="' + bookmark.nodeId + '"]');
            if (nodeElement && bookmark.partType === 'list') {
                content = nodeElement.querySelector(
                    '[data-easymde-list-item="' + String(bookmark.partIndex) + '"] [data-easymde-inline-content]'
                );
            } else if (nodeElement && bookmark.partType === 'blockquote') {
                content = nodeElement.querySelector(
                    '[data-easymde-quote-line="' + String(bookmark.partIndex) + '"] [data-easymde-inline-content]'
                );
            } else {
                content = nodeElement && nodeElement.querySelector(
                    '[data-easymde-inline-content], [data-easymde-code-content]'
                );
            }
            if (!content) {
                return false;
            }
            start = pointAtOffset(content, bookmark.start);
            end = pointAtOffset(content, bookmark.end);
            range = documentRef.createRange();
            range.setStart(start.node, start.offset);
            range.setEnd(end.node, end.offset);
            nativeSelection = windowRef.getSelection();
            nativeSelection.removeAllRanges();
            nativeSelection.addRange(range);
            selection = Object.assign({}, bookmark);
            return true;
        }

        function insertPlainText(value) {
            var nativeSelection = windowRef.getSelection && windowRef.getSelection();
            var range;
            var textNode;
            var content;
            if (!nativeSelection || nativeSelection.rangeCount < 1) {
                return false;
            }
            range = nativeSelection.getRangeAt(0);
            content = closestElement(range.startContainer, '[data-easymde-inline-content], [data-easymde-code-content]');
            if (!content || !content.contains(range.endContainer)) {
                return false;
            }
            range.deleteContents();
            textNode = documentRef.createTextNode(value);
            range.insertNode(textNode);
            range.setStartAfter(textNode);
            range.collapse(true);
            nativeSelection.removeAllRanges();
            nativeSelection.addRange(range);
            scheduleCapture(content);
            flush();
            return true;
        }

        function splitActiveBlock() {
            var bookmark = captureSelection();
            var content = activeContent();
            var node;
            var segment;
            var before;
            var after;
            var ending;
            var lineEnding;
            var replacement;
            var targetOffset;
            var prefix;
            var nextPrefix;
            var item;
            if (!bookmark || !content) {
                return false;
            }
            flush();
            modelDocument = model.parse(markdown);
            node = findModelNode(bookmark.nodeId);
            if (!node || ['paragraph', 'heading', 'list', 'blockquote'].indexOf(node.type) === -1) {
                return false;
            }
            segment = sourceSegment(node, content);
            before = model.serializeInline(inlineTokensForRange(content, 0, bookmark.start));
            after = model.serializeInline(inlineTokensForRange(
                content,
                bookmark.end,
                String(content.textContent || '').length
            ));
            ending = (segment.raw.match(/(\r\n|\r|\n)$/) || [''])[0];
            lineEnding = modelDocument.lineEnding || '\n';

            if (node.type === 'heading') {
                prefix = new Array(node.level + 1).join('#') + ' ';
                replacement = prefix + before + lineEnding + lineEnding + after + (after ? ending : '');
                targetOffset = segment.start + prefix.length + before.length + (lineEnding.length * 2);
            } else if (node.type === 'paragraph') {
                replacement = before + lineEnding + lineEnding + after + (after ? ending : '');
                targetOffset = segment.start + before.length + (lineEnding.length * 2);
            } else if (node.type === 'list') {
                item = node.items[segment.part.index];
                prefix = (segment.raw.match(/^(\s*(?:[-+*]|\d{1,9}[.)])[\t ]+(?:\[[ xX]\][\t ]+)?)/) || [])[1];
                if (!item || !prefix) {
                    throw new Error('The active visual list item cannot be split safely.');
                }
                nextPrefix = item.task ? prefix.replace(/\[[xX ]\]/, '[ ]') : prefix;
                replacement = prefix + before + lineEnding + nextPrefix + after + ending;
                targetOffset = segment.start + prefix.length + before.length + lineEnding.length;
            } else {
                prefix = (segment.raw.match(/^( {0,3}>[\t ]?)/) || [])[1];
                if (!prefix) {
                    throw new Error('The active visual blockquote line cannot be split safely.');
                }
                replacement = prefix + before + lineEnding + prefix + after + ending;
                targetOffset = segment.start + prefix.length + before.length + lineEnding.length;
            }
            return replaceSourceRange(
                segment,
                replacement,
                { input: true, split: true, nodeId: node.id },
                targetOffset,
                0,
                0
            );
        }

        function bindDom() {
            listen(root, 'beforeinput', function (event) {
                if (readOnly) {
                    event.preventDefault();
                    event.stopPropagation();
                }
            }, true);
            listen(root, 'keydown', function (event) {
                var key = String(event.key || '').toLowerCase();
                var commandKey = !!(event.ctrlKey || event.metaKey);
                if (readOnly && isMutationKey(event)) {
                    event.preventDefault();
                    event.stopPropagation();
                    return;
                }
                if (!readOnly && commandKey && key === 'z') {
                    event.preventDefault();
                    event.stopPropagation();
                    event.shiftKey ? redo() : undo();
                } else if (!readOnly && commandKey && key === 'y') {
                    event.preventDefault();
                    event.stopPropagation();
                    redo();
                } else if (!readOnly && event.key === 'Enter' && !event.isComposing) {
                    event.preventDefault();
                    if (!closestElement(event.target, '[data-easymde-code-content]') && splitActiveBlock()) {
                        event.stopPropagation();
                        return;
                    }
                    insertPlainText('\n');
                }
            }, true);
            listen(root, 'input', function (event) {
                if (!readOnly && !composing) {
                    scheduleCapture(event.target);
                }
            });
            listen(root, 'compositionstart', function () {
                composing = true;
            });
            listen(root, 'compositionend', function (event) {
                composing = false;
                scheduleCapture(event.target);
            });
            listen(root, 'paste', function (event) {
                var pasted;
                event.preventDefault();
                event.stopPropagation();
                if (readOnly) {
                    return;
                }
                if (handleFileTransfer(event, 'paste')) {
                    return;
                }
                try {
                    pasted = event.clipboardData && event.clipboardData.getData('text/plain');
                    if (!pasted) {
                        throw new Error('Visual editor paste requires plain text.');
                    }
                    insertPlainText(normalizePastedText(pasted));
                } catch (error) {
                    reportError(error);
                }
            }, true);
            listen(root, 'drop', function (event) {
                var dropped;
                event.preventDefault();
                event.stopPropagation();
                if (readOnly) {
                    return;
                }
                if (handleFileTransfer(event, 'drop')) {
                    return;
                }
                dropped = event.dataTransfer && event.dataTransfer.getData('text/plain');
                if (dropped) {
                    insertPlainText(normalizePastedText(dropped));
                }
            }, true);
            listen(root, 'change', function (event) {
                if (!readOnly && event.target.matches('[data-easymde-task-toggle], [data-easymde-code-language]')) {
                    scheduleCapture(event.target);
                    flush();
                }
            });
            listen(root, 'click', function (event) {
                var button = closestElement(event.target, '[data-easymde-edit-source]');
                var node;
                if (!button || !root.contains(button)) {
                    return;
                }
                node = findModelNode(button.getAttribute('data-easymde-edit-source'));
                if (node && typeof mountOptions.onEditSource === 'function') {
                    mountOptions.onEditSource({ id: node.id, start: node.start, end: node.end, type: node.protectedType });
                }
            });
            listen(documentRef, 'selectionchange', function () {
                if (root && documentRef.activeElement && root.contains(documentRef.activeElement)) {
                    captureSelection();
                }
            });
        }

        function mount(container, value, nextOptions) {
            if (mounted) {
                throw new Error('The visual editor adapter is already mounted.');
            }
            if (!container || !documentRef || typeof documentRef.createElement !== 'function') {
                throw new Error('A visual editor DOM container is required.');
            }
            mountOptions = nextOptions || {};
            setMarkdown(value);
            initialMarkdown = markdown;
            history.reset(markdown);
            readOnly = !!mountOptions.readOnly;
            host = container;
            root = documentRef.createElement('div');
            root.className = 'easymde-visual-editor';
            root.setAttribute('data-easymde-visual-editor', '1');
            root.setAttribute('aria-label', mountOptions.ariaLabel
                ? String(mountOptions.ariaLabel)
                : 'Visual Markdown editor');
            root.setAttribute('tabindex', '-1');
            host.textContent = '';
            host.appendChild(root);
            mounted = true;
            render();
            bindDom();
            return true;
        }

        function restoreHistoryValue(value, direction) {
            var bookmark = captureSelection();
            if (value === null || readOnly || composing) {
                return false;
            }
            try {
                modelDocument = model.parse(value);
                markdown = value;
                render();
                restoreSelection(bookmark);
                emitChange(value, { history: direction });
                return true;
            } catch (error) {
                reportError(error);
                throw error;
            }
        }

        function undo() {
            if (readOnly || composing) {
                return false;
            }
            flush();
            return restoreHistoryValue(history.undo(), 'undo');
        }

        function redo() {
            if (readOnly || composing) {
                return false;
            }
            flush();
            return restoreHistoryValue(history.redo(), 'redo');
        }

        function activeContent() {
            var nativeSelection = windowRef.getSelection && windowRef.getSelection();
            var content;
            if (nativeSelection && nativeSelection.rangeCount) {
                content = closestElement(nativeSelection.getRangeAt(0).startContainer, '[data-easymde-inline-content]');
                if (content && root && root.contains(content)) {
                    return content;
                }
            }
            content = closestElement(documentRef.activeElement, '[data-easymde-inline-content]');
            return content && root.contains(content) ? content : null;
        }

        function canExecute(command) {
            var supported = [
                'bold', 'italic', 'strike', 'inlinecode', 'link', 'paragraph', 'quote',
                'unorderedlist', 'orderedlist', 'codefence',
                'heading1', 'heading2', 'heading3', 'heading4', 'heading5', 'heading6'
            ];
            if (readOnly || composing || !mounted) {
                return false;
            }
            if (command === 'undo') {
                return history.canUndo();
            }
            if (command === 'redo') {
                return history.canRedo();
            }
            return supported.indexOf(command) !== -1 && !!activeContent();
        }

        function wrapSelection(tagName, attributes) {
            var nativeSelection = windowRef.getSelection();
            var range;
            var content = activeContent();
            var wrapper;
            var fragment;
            var nodeElement;
            if (!content || !nativeSelection || nativeSelection.rangeCount < 1) {
                return false;
            }
            range = nativeSelection.getRangeAt(0);
            if (range.collapsed || !content.contains(range.endContainer)) {
                return false;
            }
            wrapper = documentRef.createElement(tagName);
            Object.keys(attributes || {}).forEach(function (name) {
                wrapper.setAttribute(name, attributes[name]);
            });
            fragment = range.extractContents();
            if (tagName === 'code') {
                wrapper.textContent = fragment.textContent;
            } else {
                wrapper.appendChild(fragment);
            }
            range.insertNode(wrapper);
            range.selectNodeContents(wrapper);
            nativeSelection.removeAllRanges();
            nativeSelection.addRange(range);
            nodeElement = closestElement(content, '[data-easymde-node-id]');
            captureNode(nodeElement);
            render();
            restoreSelection(selection);
            return true;
        }

        function structuralCommand(command) {
            var content = activeContent();
            var nodeElement = closestElement(content, '[data-easymde-node-id]');
            var nodeId = nodeElement.getAttribute('data-easymde-node-id');
            var node;
            var segment;
            var tokens;
            var inline;
            var ending;
            var replacement;
            var bookmark = captureSelection();
            flush();
            modelDocument = model.parse(markdown);
            node = findModelNode(nodeId);
            if (!node) {
                throw new Error('The active visual Markdown node is unavailable.');
            }
            segment = sourceSegment(node, content);
            tokens = inlineTokensFromDom(content, model);
            inline = model.serializeInline(tokens);
            ending = (segment.raw.match(/(\r\n|\r|\n)$/) || [''])[0];
            if (/^heading[1-6]$/.test(command)) {
                replacement = new Array(Number(command.slice(-1)) + 1).join('#') + ' ' + inline + ending;
            } else if (command === 'paragraph') {
                replacement = inline + ending;
            } else if (command === 'quote') {
                replacement = '> ' + inline + ending;
            } else if (command === 'unorderedlist') {
                replacement = '- ' + inline + ending;
            } else if (command === 'orderedlist') {
                replacement = '1. ' + inline + ending;
            } else if (command === 'codefence') {
                replacement = '```' + modelDocument.lineEnding + content.textContent
                    + modelDocument.lineEnding + '```' + ending;
            } else {
                return false;
            }
            return replaceSourceRange(
                segment,
                replacement,
                { command: command, nodeId: node.id },
                segment.start,
                bookmark && bookmark.start,
                bookmark && bookmark.end
            );
        }

        function executeCommand(command, payload) {
            var href;
            if (!canExecute(command)) {
                return false;
            }
            if (command === 'undo') {
                return undo();
            }
            if (command === 'redo') {
                return redo();
            }
            if (command === 'bold') {
                return wrapSelection('strong');
            }
            if (command === 'italic') {
                return wrapSelection('em');
            }
            if (command === 'strike') {
                return wrapSelection('del');
            }
            if (command === 'inlinecode') {
                return wrapSelection('code');
            }
            if (command === 'link') {
                href = String(payload && payload.href || 'https://');
                if (!model.isSafeUrl(href)) {
                    reportError(new Error('Unsafe visual editor link URL.'));
                    return false;
                }
                return wrapSelection('a', { href: href });
            }
            return structuralCommand(command);
        }

        function clearNavigationTarget() {
            if (navigationTimer !== null) {
                windowRef.clearTimeout(navigationTimer);
                navigationTimer = null;
            }
            if (navigationElement) {
                navigationElement.classList.remove('is-outline-target');
                navigationElement = null;
            }
        }

        function navigateToNode(nodeId) {
            var target;
            var focusTarget;
            var reduceMotion;
            if (!root || !/^[a-z][a-zA-Z]*-\d+$/.test(String(nodeId || ''))) {
                return false;
            }
            target = root.querySelector('[data-easymde-node-id="' + nodeId + '"]');
            if (!target) {
                return false;
            }
            clearNavigationTarget();
            navigationElement = target;
            target.classList.add('is-outline-target');
            reduceMotion = !!(
                windowRef.matchMedia
                && windowRef.matchMedia('(prefers-reduced-motion: reduce)').matches
            );
            if (typeof target.scrollIntoView === 'function') {
                target.scrollIntoView({
                    behavior: reduceMotion ? 'auto' : 'smooth',
                    block: 'start'
                });
            }
            focusTarget = !readOnly
                ? target.querySelector('[data-easymde-inline-content], [data-easymde-code-content]')
                : target;
            if (focusTarget && typeof focusTarget.focus === 'function') {
                if (focusTarget === target) {
                    target.setAttribute('tabindex', '-1');
                }
                try {
                    focusTarget.focus({ preventScroll: true });
                } catch (error) {
                    focusTarget.focus();
                }
            }
            navigationTimer = windowRef.setTimeout(clearNavigationTarget, 1200);
            return true;
        }

        function navigateToSourceOffset(value) {
            var offset = Number(value);
            var node;

            if (!modelDocument || !Number.isInteger(offset) || offset < 0) {
                return false;
            }
            node = modelDocument.nodes.find(function (candidate) {
                return candidate.start <= offset
                    && (offset < candidate.end || (candidate.start === candidate.end && offset === candidate.start));
            });
            return node ? navigateToNode(node.id) : false;
        }

        function destroy() {
            if (!mounted) {
                return false;
            }
            cancelPendingCapture();
            clearNavigationTarget();
            listeners.splice(0).forEach(function (remove) { remove(); });
            if (root && typeof root.remove === 'function') {
                root.remove();
            }
            mounted = false;
            composing = false;
            host = null;
            root = null;
            selection = null;
            mountOptions = {};
            return true;
        }

        return {
            mount: mount,
            setMarkdown: setMarkdown,
            getMarkdown: function () { return flush(); },
            flush: flush,
            focus: function () {
                var target = root && root.querySelector('[data-easymde-inline-content], [data-easymde-code-content]');
                if (!target || typeof target.focus !== 'function') {
                    return false;
                }
                target.focus();
                return true;
            },
            executeCommand: executeCommand,
            canExecute: canExecute,
            hasChanges: function () {
                return initialMarkdown !== null && flush() !== initialMarkdown;
            },
            undo: undo,
            redo: redo,
            setReadOnly: function (value) {
                var next = !!value;
                if (next && !readOnly && !composing) {
                    flush();
                }
                readOnly = next;
                applyReadOnlyState();
                return readOnly;
            },
            isReadOnly: function () { return readOnly; },
            isComposing: function () { return composing; },
            getSelection: captureSelection,
            restoreSelection: restoreSelection,
            navigateToNode: navigateToNode,
            navigateToSourceOffset: navigateToSourceOffset,
            destroy: destroy,
            onChange: function (callback) {
                if (typeof callback !== 'function') {
                    throw new Error('Visual editor change callback must be a function.');
                }
                changeCallbacks.push(callback);
                return function () {
                    changeCallbacks = changeCallbacks.filter(function (item) { return item !== callback; });
                };
            },
            onError: function (callback) {
                if (typeof callback !== 'function') {
                    throw new Error('Visual editor error callback must be a function.');
                }
                errorCallbacks.push(callback);
                return function () {
                    errorCallbacks = errorCallbacks.filter(function (item) { return item !== callback; });
                };
            }
        };
    }

    window.EasyMDEVisualEditorAdapter = {
        createAdapter: createAdapter,
        createHistory: createHistory,
        inlineTokensFromDom: inlineTokensFromDom,
        isMutationKey: isMutationKey,
        normalizePastedText: normalizePastedText
    };
}(window));
