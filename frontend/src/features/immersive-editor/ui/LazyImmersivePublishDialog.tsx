import {
  createElement,
  useEffect,
  useRef,
  useState
} from '@wordpress/element';
import type { ComponentProps, ComponentType } from 'react';

import type { ImmersivePublishDialog } from './ImmersivePublishDialog';

type PublishDialogProps = ComponentProps<typeof ImmersivePublishDialog>;
type PublishDialogComponent = ComponentType<PublishDialogProps>;

let cachedComponent: PublishDialogComponent | null = null;
let pendingLoad: Promise<PublishDialogComponent> | null = null;

function loadPublishDialogComponent(): Promise<PublishDialogComponent> {
  if (cachedComponent) {
    return Promise.resolve(cachedComponent);
  }
  if (!pendingLoad) {
    pendingLoad = import('./ImmersivePublishDialog')
      .then((module) => {
        cachedComponent = module.ImmersivePublishDialog;
        return cachedComponent;
      })
      .catch((error: unknown) => {
        pendingLoad = null;
        throw error;
      });
  }
  return pendingLoad;
}

/**
 * Resets the module-level lazy component cache in unit tests.
 */
export function resetImmersivePublishDialogCacheForTests(): void {
  cachedComponent = null;
  pendingLoad = null;
}

export type LazyImmersivePublishDialogProps = PublishDialogProps &
  Readonly<{
    onLoadFailure: (code: string) => void;
  }>;

/**
 * Lazily loads the immersive publish dialog ESM chunk on first open and caches
 * it so ordinary editor startup never downloads the publish modal.
 */
export function LazyImmersivePublishDialog({
  onLoadFailure,
  ...dialogProps
}: LazyImmersivePublishDialogProps) {
  const [LoadedComponent, setLoadedComponent] =
    useState<PublishDialogComponent | null>(() => cachedComponent);
  const onLoadFailureRef = useRef(onLoadFailure);
  onLoadFailureRef.current = onLoadFailure;

  useEffect(() => {
    if (LoadedComponent) {
      return undefined;
    }
    let cancelled = false;
    void loadPublishDialogComponent()
      .then((component) => {
        if (!cancelled) {
          setLoadedComponent(() => component);
        }
      })
      .catch(() => {
        if (!cancelled) {
          onLoadFailureRef.current('immersive-publish-dialog-load-failed');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [LoadedComponent]);

  if (!LoadedComponent) {
    return null;
  }

  return <LoadedComponent {...dialogProps} />;
}
