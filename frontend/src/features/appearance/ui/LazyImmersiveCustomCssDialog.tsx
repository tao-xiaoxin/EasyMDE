import {
  createElement,
  useEffect,
  useRef,
  useState
} from '@wordpress/element';
import type { ComponentProps, ComponentType } from 'react';

import type { ImmersiveCustomCssDialog } from './ImmersiveCustomCssDialog';

type CustomCssDialogProps = ComponentProps<typeof ImmersiveCustomCssDialog>;
type CustomCssDialogComponent = ComponentType<CustomCssDialogProps>;

let cachedComponent: CustomCssDialogComponent | null = null;
let pendingLoad: Promise<CustomCssDialogComponent> | null = null;

function loadCustomCssDialogComponent(): Promise<CustomCssDialogComponent> {
  if (cachedComponent) {
    return Promise.resolve(cachedComponent);
  }
  if (!pendingLoad) {
    pendingLoad = import('./ImmersiveCustomCssDialog')
      .then((module) => {
        cachedComponent = module.ImmersiveCustomCssDialog;
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
export function resetImmersiveCustomCssDialogCacheForTests(): void {
  cachedComponent = null;
  pendingLoad = null;
}

export type LazyImmersiveCustomCssDialogProps = CustomCssDialogProps &
  Readonly<{
    onLoadFailure: () => void;
  }>;

/**
 * Lazily loads the immersive Custom CSS dialog ESM chunk on first open and
 * caches it so ordinary editor startup never downloads the Custom CSS modal.
 */
export function LazyImmersiveCustomCssDialog({
  onLoadFailure,
  ...dialogProps
}: LazyImmersiveCustomCssDialogProps) {
  const [LoadedComponent, setLoadedComponent] =
    useState<CustomCssDialogComponent | null>(() => cachedComponent);
  const onLoadFailureRef = useRef(onLoadFailure);
  onLoadFailureRef.current = onLoadFailure;

  useEffect(() => {
    if (LoadedComponent) {
      return undefined;
    }
    let cancelled = false;
    void loadCustomCssDialogComponent()
      .then((component) => {
        if (!cancelled) {
          setLoadedComponent(() => component);
        }
      })
      .catch(() => {
        if (!cancelled) {
          onLoadFailureRef.current();
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
