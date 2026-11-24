import { createElement, useEffect, useRef, useState } from '@wordpress/element';
import type { CSSProperties, ComponentType } from 'react';

import type {
  ImmersiveVisualEditorRuntime,
  VisualEditorGeneratedPreviewIdentity,
  VisualGeneratedRuntimePort
} from '../../contracts/visual-editor';
import type { EditorDocumentSession } from '../../features/document-source/ui/EditorDocumentSource';
import type { MountedProseMirrorVisualEditorProps } from '../../features/immersive-visual/MountedProseMirrorVisualEditor';

type VisualEditorComponent = ComponentType<MountedProseMirrorVisualEditorProps>;

let cachedComponent: VisualEditorComponent | null = null;
let pendingLoad: Promise<VisualEditorComponent> | null = null;

function loadVisualEditorComponent(): Promise<VisualEditorComponent> {
  if (cachedComponent) {
    return Promise.resolve(cachedComponent);
  }
  if (!pendingLoad) {
    pendingLoad = import(
      '../../features/immersive-visual/MountedProseMirrorVisualEditor'
    )
      .then((module) => {
        cachedComponent = module.MountedProseMirrorVisualEditor;
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
 * Loads the lazy ProseMirror visual editor ESM chunk on demand and caches it
 * so subsequent unlocks render synchronously without reloading the chunk.
 */
export function preloadImmersiveVisualEditor(): Promise<void> {
  return loadVisualEditorComponent().then(() => undefined);
}

/**
 * Resets the module-level lazy component cache in unit tests.
 */
export function resetImmersiveVisualEditorCacheForTests(): void {
  cachedComponent = null;
  pendingLoad = null;
}

export type ImmersiveVisualEditorHostProps = Readonly<{
  className?: string;
  documentSession: EditorDocumentSession;
  editable?: boolean;
  getGeneratedPreviewIdentity?: () => VisualEditorGeneratedPreviewIdentity | null;
  imagePasteUploadEnabled: boolean;
  imageUploadEnabled: boolean;
  label?: string;
  onCanonicalDocumentChange?: (markdown: string) => void;
  onDispose: (runtime: ImmersiveVisualEditorRuntime) => void;
  onFailure: (code: string) => void;
  onImageDropFiles?: (files: ReadonlyArray<File>, event: DragEvent) => void;
  onImagePasteFiles?: (
    files: ReadonlyArray<File>,
    event: ClipboardEvent
  ) => void;
  onMarkdownChange: (markdown: string) => void;
  onReady: (runtime: ImmersiveVisualEditorRuntime) => void;
  protectedAtomLabels?: MountedProseMirrorVisualEditorProps['protectedAtomLabels'];
  protectedAtomLabelTemplates?: MountedProseMirrorVisualEditorProps['protectedAtomLabelTemplates'];
  style?: CSSProperties;
  visualRuntimePort?: VisualGeneratedRuntimePort;
}>;

/**
 * Single pluggable host seam for the immersive visual editor surface.
 * Lazily loads the unified ProseMirror visual editor ESM chunk on first unlock
 * so ordinary editing never downloads ProseMirror or markdown-it.
 */
export function ImmersiveVisualEditorHost({
  className,
  documentSession,
  editable,
  getGeneratedPreviewIdentity,
  imagePasteUploadEnabled,
  imageUploadEnabled,
  label,
  onCanonicalDocumentChange,
  onDispose,
  onFailure,
  onImageDropFiles,
  onImagePasteFiles,
  onMarkdownChange,
  onReady,
  protectedAtomLabels,
  protectedAtomLabelTemplates,
  style,
  visualRuntimePort
}: ImmersiveVisualEditorHostProps) {
  const [LoadedComponent, setLoadedComponent] =
    useState<VisualEditorComponent | null>(() => cachedComponent);
  const onFailureRef = useRef(onFailure);
  onFailureRef.current = onFailure;

  useEffect(() => {
    if (LoadedComponent) {
      return undefined;
    }
    let active = true;
    void loadVisualEditorComponent()
      .then((component) => {
        if (active) {
          setLoadedComponent(() => component);
        }
      })
      .catch(() => {
        if (active) {
          onFailureRef.current('visual-editor-load-failed');
        }
      });
    return () => {
      active = false;
    };
  }, [LoadedComponent]);

  if (!LoadedComponent) {
    return (
      <div
        className={className}
        style={style}
        aria-busy="true"
        data-easymde-visual-loading="1"
      />
    );
  }

  return (
    <LoadedComponent
      documentSession={documentSession}
      imagePasteUploadEnabled={imagePasteUploadEnabled}
      imageUploadEnabled={imageUploadEnabled}
      onDispose={onDispose}
      onFailure={onFailure}
      onMarkdownChange={onMarkdownChange}
      onReady={onReady}
      {...(className !== undefined ? { className } : {})}
      {...(editable !== undefined ? { editable } : {})}
      {...(getGeneratedPreviewIdentity !== undefined
        ? { getGeneratedPreviewIdentity }
        : {})}
      {...(label !== undefined ? { label } : {})}
      {...(onCanonicalDocumentChange !== undefined
        ? { onCanonicalDocumentChange }
        : {})}
      {...(onImageDropFiles !== undefined ? { onImageDropFiles } : {})}
      {...(onImagePasteFiles !== undefined ? { onImagePasteFiles } : {})}
      {...(protectedAtomLabels !== undefined ? { protectedAtomLabels } : {})}
      {...(protectedAtomLabelTemplates !== undefined
        ? { protectedAtomLabelTemplates }
        : {})}
      {...(style !== undefined ? { style } : {})}
      {...(visualRuntimePort !== undefined ? { visualRuntimePort } : {})}
    />
  );
}
