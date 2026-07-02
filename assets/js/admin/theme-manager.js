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

    window.EasyMDEThemeManager = {
        normalizeRenderState: normalizeRenderState,
        selectedCustomCssItem: selectedCustomCssItem,
        selectedCustomCss: selectedCustomCss
    };
})(window);
