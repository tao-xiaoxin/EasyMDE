import {
  renderMathContent,
  type FrontendEnhancementWindow
} from '../integrations/preview-runtime/frontend-enhancement-runtime';

const windowRef = window as unknown as FrontendEnhancementWindow;

windowRef.EasyMDEMathRenderer = {
  render: (root, config) => renderMathContent(root, config, windowRef)
};
