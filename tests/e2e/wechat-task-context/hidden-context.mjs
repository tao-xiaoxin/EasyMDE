// Hidden WeChat task-context evidence facade.
// Existing callers keep importing this module; the implementation is split by
// responsibility into property vectors, the shared comparator, the browser
// evidence installation, and the Node-side assertions.

export {
  CROSS_ROOT_STYLE_EXCLUDED_PROPERTIES,
  HIDDEN_CURRENT_SIGNATURE_LAYOUT_PROPERTIES,
  HIDDEN_INPUT_LAYOUT_STYLE_PROPERTIES,
  HIDDEN_INPUT_STYLE_PROPERTIES,
  HIDDEN_LIST_ITEM_LAYOUT_STYLE_PROPERTIES,
  HIDDEN_LI_STYLE_PROPERTIES,
  HIDDEN_PSEUDO_LAYOUT_STYLE_PROPERTIES,
  HIDDEN_PSEUDO_STYLE_PROPERTIES,
  HIDDEN_ROOT_STYLE_PROPERTIES,
  HIDDEN_SEMANTIC_STYLE_PROPERTIES,
  INPUT_STYLE_PROPERTIES,
  LI_STYLE_PROPERTIES,
  PSEUDO_STYLE_PROPERTIES,
  ROOT_STYLE_PROPERTIES
} from "./hidden-context-properties.mjs";
export { createHiddenContextComparator } from "./hidden-context-comparator.mjs";
export { installHiddenContextEvidence } from "./hidden-context-installation.mjs";
export { assertHiddenContextEvidence } from "./hidden-context-assertion.mjs";
