import type { FrontendEnhancementWindow } from '../integrations/preview-runtime/frontend-enhancement-runtime';

const windowRef = window as unknown as FrontendEnhancementWindow;

document.addEventListener('DOMContentLoaded', () => {
  const config = windowRef.EasyMDEFrontendConfig || {};

  if (!windowRef.EasyMDEEnhancements) {
    return;
  }

  void windowRef.EasyMDEEnhancements.enhance(document, config);
});
