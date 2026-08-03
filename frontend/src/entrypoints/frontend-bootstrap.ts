import type { FrontendEnhancementWindow } from '../integrations/preview-runtime/frontend-enhancement-runtime';

const windowRef = window as unknown as FrontendEnhancementWindow;

function bootstrap(): void {
  const config = windowRef.EasyMDEFrontendConfig || {};

  if (!windowRef.EasyMDEEnhancements) {
    return;
  }

  void windowRef.EasyMDEEnhancements.enhance(document, config);
}

if ('loading' === document.readyState) {
  document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
} else {
  bootstrap();
}
