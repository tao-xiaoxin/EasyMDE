// Hidden WeChat task-context style-property vectors and layout guards.
// The arrays are shared by the browser evidence installation and the Node-side
// comparator contract checks; keep one authoritative copy here.

export const INPUT_STYLE_PROPERTIES = [
  'display', 'width', 'height', 'position', 'box-sizing', 'appearance',
  '-webkit-appearance', 'accent-color', 'margin-top', 'margin-right',
  'margin-bottom', 'margin-left', 'padding-top', 'padding-right',
  'padding-bottom', 'padding-left', 'border-top-width', 'border-right-width',
  'border-bottom-width', 'border-left-width', 'border-radius', 'transform',
  'transform-origin', 'opacity', 'font-family', 'font-size', 'line-height',
  'letter-spacing', 'word-spacing', 'font-weight'
];
export const PSEUDO_STYLE_PROPERTIES = [
  'display', 'width', 'height', 'position', 'box-sizing', 'top', 'right',
  'bottom', 'left', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'transform',
  'transform-origin', 'opacity', 'font-family', 'font-size', 'line-height',
  'content', 'background', 'background-color', 'color', 'border-top-width',
  'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-color', 'border-right-color', 'border-bottom-color',
  'border-left-color'
];
export const LI_STYLE_PROPERTIES = [
  'display', 'position', 'box-sizing', 'width', 'min-width', 'max-width',
  'height', 'min-height', 'max-height', 'padding-top', 'padding-right',
  'padding-bottom', 'padding-left', 'border-top-width', 'border-right-width',
  'border-bottom-width', 'border-left-width', 'border-radius', 'margin-top',
  'margin-right', 'margin-bottom', 'margin-left', 'font-family', 'font-size',
  'font-weight', 'line-height', 'letter-spacing', 'word-spacing', 'white-space',
  'vertical-align'
];
export const ROOT_STYLE_PROPERTIES = [
  'display', 'position', 'box-sizing', 'width', 'height', 'padding-top',
  'padding-right', 'padding-bottom', 'padding-left', 'border-top-width',
  'border-right-width', 'border-bottom-width', 'border-left-width',
  'font-family', 'font-size', 'line-height', 'font-weight', 'letter-spacing',
  'word-spacing'
];
export const CROSS_ROOT_STYLE_EXCLUDED_PROPERTIES = ['height'];
export const HIDDEN_INPUT_STYLE_PROPERTIES = [
  'display', 'width', 'height', 'position', 'box-sizing', 'appearance',
  '-webkit-appearance', 'accent-color', 'margin-top', 'margin-right',
  'margin-bottom', 'margin-left', 'padding-top', 'padding-right',
  'padding-bottom', 'padding-left', 'border-top-width', 'border-right-width',
  'border-bottom-width', 'border-left-width', 'border-radius', 'transform',
  'transform-origin', 'opacity', 'font-family', 'font-size', 'line-height',
  'letter-spacing', 'word-spacing', 'font-weight'
];
export const HIDDEN_PSEUDO_STYLE_PROPERTIES = [
  'content', 'display', 'width', 'height', 'position', 'box-sizing', 'top',
  'right', 'bottom', 'left', 'margin-top', 'margin-right', 'margin-bottom',
  'margin-left', 'padding-top', 'padding-right', 'padding-bottom',
  'padding-left', 'transform', 'transform-origin', 'opacity', 'font-family',
  'font-size', 'line-height', 'background', 'background-color',
  'border-top-width', 'border-right-width', 'border-bottom-width',
  'border-left-width', 'border-top-color', 'border-right-color',
  'border-bottom-color', 'border-left-color'
];
export const HIDDEN_LI_STYLE_PROPERTIES = [
  'display', 'position', 'box-sizing', 'width', 'min-width', 'max-width',
  'height', 'min-height', 'max-height', 'padding-top', 'padding-right',
  'padding-bottom', 'padding-left', 'border-top-width', 'border-right-width',
  'border-bottom-width', 'border-left-width', 'border-radius', 'margin-top',
  'margin-right', 'margin-bottom', 'margin-left', 'font-family', 'font-size',
  'font-weight', 'line-height', 'letter-spacing', 'word-spacing',
  'white-space', 'vertical-align'
];
export const HIDDEN_ROOT_STYLE_PROPERTIES = [
  'box-sizing', 'padding-top', 'padding-right', 'padding-bottom',
  'padding-left', 'border-top-width', 'border-right-width',
  'border-bottom-width', 'border-left-width', 'font-family', 'font-size',
  'font-weight', 'line-height', 'letter-spacing', 'word-spacing'
];
export const HIDDEN_SEMANTIC_STYLE_PROPERTIES = [
  'display', 'visibility', 'content-visibility', 'position', 'width', 'height',
  'opacity', 'font-family', 'font-size', 'line-height'
];
// Hidden measurement signatures omit the layout fields that production validates
// through used geometry and stale/currentness guards, scoped to each owner role.
export const HIDDEN_INPUT_LAYOUT_STYLE_PROPERTIES = [
  'width', 'height', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'transform', 'transform-origin'
];
export const HIDDEN_LIST_ITEM_LAYOUT_STYLE_PROPERTIES = [
  'width', 'min-width', 'max-width', 'height', 'min-height', 'max-height',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left'
];
export const HIDDEN_PSEUDO_LAYOUT_STYLE_PROPERTIES = [
  'width', 'height', 'top', 'right', 'bottom', 'left',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'transform', 'transform-origin'
];
export const HIDDEN_CURRENT_SIGNATURE_LAYOUT_PROPERTIES = Object.freeze({
  input: HIDDEN_INPUT_LAYOUT_STYLE_PROPERTIES,
  li: HIDDEN_LIST_ITEM_LAYOUT_STYLE_PROPERTIES,
  'pseudo-before': HIDDEN_PSEUDO_LAYOUT_STYLE_PROPERTIES,
  'pseudo-after': HIDDEN_PSEUDO_LAYOUT_STYLE_PROPERTIES
});
