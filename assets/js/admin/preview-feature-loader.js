(function (window, document) {
    'use strict';

    var resourceCache = {};
    var featureCache = {};

    function cached(cache, key, factory) {
        var record = cache[key];

        if (record) {
            return record.promise;
        }

        record = {
            key: key,
            status: 'loading',
            error: null,
            promise: null
        };

        record.promise = Promise.resolve().then(factory).then(function () {
            record.status = 'loaded';
            return record;
        }).catch(function (error) {
            record.status = 'failed';
            record.error = error || null;
            return record;
        });

        cache[key] = record;
        return record.promise;
    }

    function skipped(key) {
        return Promise.resolve({
            key: key,
            status: 'skipped',
            error: null
        });
    }

    function setAttribute(node, name, value) {
        if (node && typeof node.setAttribute === 'function') {
            node.setAttribute(name, value);
            return;
        }

        node[name] = value;
    }

    function getAttribute(node, name) {
        if (node && typeof node.getAttribute === 'function') {
            return node.getAttribute(name);
        }

        return node ? node[name] : '';
    }

    function on(node, eventName, handler) {
        if (node && typeof node.addEventListener === 'function') {
            node.addEventListener(eventName, handler, false);
            return function () {
                if (typeof node.removeEventListener === 'function') {
                    node.removeEventListener(eventName, handler, false);
                }
            };
        }

        node['on' + eventName] = handler;
        return function () {
            if (node['on' + eventName] === handler) {
                node['on' + eventName] = null;
            }
        };
    }

    function onResourceSettled(node, resolve, reject, onLoad) {
        var removeLoad = function () {};
        var removeError = function () {};

        removeLoad = on(node, 'load', function () {
            removeLoad();
            removeError();

            if (onLoad) {
                onLoad();
            }

            resolve();
        });

        removeError = on(node, 'error', function (error) {
            removeLoad();
            removeError();
            reject(error);
        });
    }

    function markStylesheetLoaded(link, href) {
        if (link && link.dataset) {
            link.dataset.easymdeLoadedHref = href;
        }
    }

    function stylesheetLoaded(link, href) {
        return !!(
            link
            && (
                (link.dataset && link.dataset.easymdeLoadedHref === href)
                || link.sheet
            )
        );
    }

    function appendToHead(node, documentRef) {
        if (node.parentNode) {
            return;
        }

        (documentRef.head || documentRef.getElementsByTagName('head')[0]).appendChild(node);
    }

    function loadStylesheet(id, href, documentRef) {
        var key = 'style:' + id + ':' + href;

        documentRef = documentRef || document;

        if (!id || !href) {
            return skipped(key);
        }

        return cached(resourceCache, key, function () {
            return new Promise(function (resolve, reject) {
                var link = documentRef.getElementById(id);

                if (link && getAttribute(link, 'href') === href && stylesheetLoaded(link, href)) {
                    resolve();
                    return;
                }

                if (!link) {
                    link = documentRef.createElement('link');
                    link.id = id;
                    link.rel = 'stylesheet';
                }

                if (link.dataset) {
                    delete link.dataset.easymdeLoadedHref;
                }

                onResourceSettled(link, resolve, reject, function () {
                    markStylesheetLoaded(link, href);
                });

                if (getAttribute(link, 'href') !== href) {
                    setAttribute(link, 'href', href);
                }

                appendToHead(link, documentRef);
            });
        });
    }

    function loadScript(id, src, documentRef) {
        var key = 'script:' + id + ':' + src;

        documentRef = documentRef || document;

        if (!id || !src) {
            return skipped(key);
        }

        return cached(resourceCache, key, function () {
            return new Promise(function (resolve, reject) {
                var script = documentRef.getElementById(id);

                if (script && getAttribute(script, 'src') === src && script.dataset && script.dataset.easymdeLoaded) {
                    resolve();
                    return;
                }

                if (!script) {
                    script = documentRef.createElement('script');
                    script.id = id;
                    script.async = false;
                }

                onResourceSettled(script, resolve, reject, function () {
                    if (script.dataset) {
                        script.dataset.easymdeLoaded = '1';
                    }
                });
                setAttribute(script, 'src', src);
                appendToHead(script, documentRef);
            });
        });
    }

    function findCodeThemeUrl(config, renderState) {
        var themes = config && config.themeOptions ? config.themeOptions.codeThemes || [] : [];
        var id = renderState && renderState.codeTheme ? renderState.codeTheme : 'atom-one-dark';
        var found = '';

        themes.some(function (theme) {
            if (theme && theme.id === id) {
                found = theme.cssUrl || '';
                return true;
            }

            return false;
        });

        return found;
    }

    function rejectFailed(results) {
        var failed = (results || []).some(function (result) {
            return result && result.status === 'failed';
        });

        if (failed) {
            throw results;
        }

        return results;
    }

    function featureKey(name, context) {
        var config = context && context.config ? context.config : {};
        var assets = config.previewAssets || {};
        var renderState = context && context.renderState ? context.renderState : {};

        if ('syntaxHighlight' === name) {
            return [
                name,
                assets.highlightScriptUrl || '',
                findCodeThemeUrl(config, renderState)
            ].join(':');
        }

        if ('math' === name) {
            return [
                name,
                assets.mathCssUrl || '',
                assets.katexCssUrl || '',
                assets.katexScriptUrl || '',
                assets.mathRendererUrl || ''
            ].join(':');
        }

        if ('mermaid' === name) {
            return [
                name,
                assets.mermaidScriptUrl || '',
                assets.mermaidRendererUrl || ''
            ].join(':');
        }

        return name;
    }

    function loadPreviewFeature(name, context) {
        var config = context && context.config ? context.config : {};
        var assets = config.previewAssets || {};
        var documentRef = context && context.documentRef ? context.documentRef : document;
        var renderState = context && context.renderState ? context.renderState : {};
        var key = featureKey(name, context);

        return cached(featureCache, key, function () {
            if ('syntaxHighlight' === name) {
                return Promise.all([
                    loadStylesheet(assets.highlightThemeLinkId || 'easymde-highlight-theme-css', findCodeThemeUrl(config, renderState), documentRef),
                    loadScript('easymde-highlight-js', assets.highlightScriptUrl, documentRef)
                ]).then(rejectFailed);
            }

            if ('math' === name) {
                return Promise.all([
                    loadStylesheet(assets.mathCssLinkId || 'easymde-math-css', assets.mathCssUrl, documentRef),
                    loadStylesheet(assets.katexCssLinkId || 'easymde-katex-css', assets.katexCssUrl, documentRef),
                    loadScript('easymde-katex-js', assets.katexScriptUrl, documentRef)
                ]).then(rejectFailed).then(function () {
                    return loadScript('easymde-math-renderer-js', assets.mathRendererUrl, documentRef).then(function (result) {
                        return rejectFailed([result]);
                    });
                });
            }

            if ('mermaid' === name) {
                return loadScript('easymde-mermaid-js', assets.mermaidScriptUrl, documentRef).then(function (result) {
                    return rejectFailed([result]);
                }).then(function () {
                    return loadScript('easymde-mermaid-renderer-js', assets.mermaidRendererUrl, documentRef).then(function (result) {
                        return rejectFailed([result]);
                    });
                });
            }

            return skipped(key);
        });
    }

    function normalizeFeatures(features) {
        features = features || {};

        return {
            darkMode: features.darkMode !== false,
            localDrafts: features.localDrafts !== false,
            codeBlocks: !!features.codeBlocks,
            syntaxHighlight: !!features.syntaxHighlight,
            mermaid: !!features.mermaid,
            math: !!features.math,
            toc: !!features.toc,
            wechatCopy: features.wechatCopy !== false
        };
    }

    function ensurePreviewFeatures(features, context) {
        var normalized = normalizeFeatures(features);
        var config = context && context.config ? context.config : {};
        var assets = config.previewAssets || {};
        var documentRef = context && context.documentRef ? context.documentRef : document;
        var renderState = context && context.renderState ? context.renderState : {};
        var tasks = [];

        if (normalized.codeBlocks && renderState.codeMacStyle) {
            tasks.push(loadStylesheet(assets.codeFrameLinkId || 'easymde-code-frame-css', assets.codeFrameCssUrl, documentRef));
        }

        if (normalized.syntaxHighlight) {
            tasks.push(loadPreviewFeature('syntaxHighlight', context));
        }

        if (normalized.math) {
            tasks.push(loadPreviewFeature('math', context));
        }

        if (normalized.toc) {
            tasks.push(loadStylesheet(assets.tocCssLinkId || 'easymde-toc-css', assets.tocCssUrl, documentRef));
        }

        if (normalized.mermaid) {
            tasks.push(loadPreviewFeature('mermaid', context));
        }

        return Promise.all(tasks).then(function (results) {
            return {
                features: normalized,
                results: results
            };
        });
    }

    window.EasyMDEPreviewFeatureLoader = {
        ensurePreviewFeatures: ensurePreviewFeatures,
        loadPreviewFeature: loadPreviewFeature,
        loadStylesheet: loadStylesheet,
        loadScript: loadScript,
        normalizeFeatures: normalizeFeatures
    };
})(window, document);
