import {
  renderMathContent,
  type FrontendEnhancementWindow
} from '../integrations/preview-runtime/frontend-enhancement-runtime';

const windowRef = window as unknown as FrontendEnhancementWindow;

windowRef.EasyMDEMathRenderer = {
  render: (root, config, control) =>
    renderMathContent(
      root,
      config,
      windowRef,
      control ? { control } : {}
    )
};
