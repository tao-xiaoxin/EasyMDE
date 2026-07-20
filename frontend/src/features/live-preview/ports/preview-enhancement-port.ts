import type { PreviewFeatures } from '../../../contracts/ports/preview-request';

export type PreviewEnhancementPort = Readonly<{
  enhance: (
    surface: HTMLElement,
    features: PreviewFeatures,
    isCurrent: () => boolean
  ) => Promise<void>;
}>;
