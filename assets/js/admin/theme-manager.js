(function (window) {
    'use strict';

    function normalizeRenderState(state) {
        state = state || {};

        return {
            markdownTheme: state.markdownTheme || 'default',
            codeTheme: state.codeTheme || 'atom-one-dark',
            codeMacStyle: state.codeMacStyle === undefined ? true : !!state.codeMacStyle,
            customCssId: state.customCssId || '',
            customCss: state.customCss || '',
            scopedCustomCss: state.scopedCustomCss || '',
            customFont: state.customFont || 'optima',
            windowsFont: state.windowsFont || 'microsoft-yahei',
            appleFont: state.appleFont || 'pingfang-sc-light',
            serifFont: state.serifFont || 'yes'
        };
    }

    function selectedCustomCssItem(renderState, customCssLibrary, findById) {
        if (renderState.markdownTheme !== 'custom' || !renderState.customCssId) {
            return null;
        }

        return findById(customCssLibrary, renderState.customCssId);
    }

    function selectedCustomCss(renderState, customCssLibrary, findById) {
        var item = selectedCustomCssItem(renderState, customCssLibrary, findById);

        if (item) {
            return item.scopedCss || '';
        }

        return renderState.scopedCustomCss || '';
    }

    function applyStylesheetLink(documentRef, id, href) {
        var link;

        if (!documentRef) {
            return null;
        }

        link = documentRef.getElementById(id);

        if (!href) {
            if (link && link.parentNode) {
                link.parentNode.removeChild(link);
            }

            return null;
        }

        if (!link) {
            link = documentRef.createElement('link');
            link.id = id;
            link.rel = 'stylesheet';
            documentRef.head.appendChild(link);
        }

        if (link.getAttribute('href') !== href) {
            link.setAttribute('href', href);
        }

        return link;
    }

    function applyArticleThemeLink(themeOptions, renderState, findById, documentRef) {
        var articleTheme;
        var href;

        if (!themeOptions || !renderState || renderState.markdownTheme === 'custom') {
            return applyStylesheetLink(documentRef || window.document, 'easymde-article-theme-css', '');
        }

        articleTheme = findById(themeOptions.markdownThemes || [], renderState.markdownTheme);
        href = articleTheme && articleTheme.cssUrl ? articleTheme.cssUrl : '';

        return applyStylesheetLink(documentRef || window.document, 'easymde-article-theme-css', href);
    }

    window.EasyMDEThemeManager = {
        normalizeRenderState: normalizeRenderState,
        selectedCustomCssItem: selectedCustomCssItem,
        selectedCustomCss: selectedCustomCss,
        applyArticleThemeLink: applyArticleThemeLink
    };
})(window);
