import {
  renderMermaidContent,
  type FrontendEnhancementWindow
} from '../integrations/preview-runtime/frontend-enhancement-runtime';

const windowRef = window as unknown as FrontendEnhancementWindow;

windowRef.EasyMDEMermaidRenderer = {
  render: (root, config, control) =>
    renderMermaidContent(
      root,
      config,
      windowRef,
      control ? { control } : {}
    )
};
