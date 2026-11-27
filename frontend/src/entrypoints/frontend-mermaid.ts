import {
  readCachedMermaidSvg,
  renderMermaidContent,
  writeCachedMermaidSvg,
  type FrontendEnhancementWindow
} from '../integrations/preview-runtime/frontend-enhancement-runtime';

const windowRef = window as unknown as FrontendEnhancementWindow;

windowRef.EasyMDEMermaidRenderer = {
  readCachedSvg: (source, renderId) =>
    readCachedMermaidSvg(source, renderId, windowRef),
  render: (root, config, control) =>
    renderMermaidContent(
      root,
      config,
      windowRef,
      control ? { control } : {}
    ),
  writeCachedSvg: (source, renderId, svg) =>
    writeCachedMermaidSvg(source, renderId, svg, windowRef)
};
