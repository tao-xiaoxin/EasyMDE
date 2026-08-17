import './frontend-math';
import './frontend-mermaid';

import {
  enhanceFrontendContent,
  syncCodeFrameBackgrounds,
  type FrontendEnhancementWindow
} from '../integrations/preview-runtime/frontend-enhancement-runtime';

const windowRef = window as unknown as FrontendEnhancementWindow;

windowRef.EasyMDEEnhancements = {
  enhance: (root, config) => enhanceFrontendContent(root, config, windowRef),
  syncCodeFrameBackgrounds: (root) => syncCodeFrameBackgrounds(root, windowRef)
};
