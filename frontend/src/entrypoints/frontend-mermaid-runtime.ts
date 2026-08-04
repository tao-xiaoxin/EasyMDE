import mermaid from 'mermaid';

import type { FrontendEnhancementWindow } from '../integrations/preview-runtime/frontend-enhancement-runtime';

const windowRef = window as unknown as FrontendEnhancementWindow;

// Keep the browser-global boundary for WordPress and Preview while the
// Mermaid implementation itself is owned by the locked npm package.
windowRef.mermaid = mermaid as unknown as NonNullable<FrontendEnhancementWindow['mermaid']>;
